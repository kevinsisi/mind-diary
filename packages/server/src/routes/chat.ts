import { Router, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { sqlite } from "../db/connection.js";
import { AGENTS, AgentPersona } from "../ai/agents.js";
import { callGeminiText } from "../ai/geminiRetry.js";
import { analyzeImage } from "../ai/geminiClient.js";
import { selectAgentsWithAI } from "../ai/diaryAnalyzer.js";
import { IMAGES_DIR } from "./diaryImages.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { extractAndStoreUserMemories, formatUserMemories } from "../services/userMemory.js";

// ── Multer for chat image uploads (disk storage, served as static) ───
const CHAT_IMAGES_DIR = path.join(IMAGES_DIR, "chat");
fs.mkdirSync(CHAT_IMAGES_DIR, { recursive: true });

const chatImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CHAT_IMAGES_DIR),
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${unique}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`不支援的圖片格式: ${file.mimetype}`));
    }
  },
});

const router = Router();

// All chat routes parse auth; user_id=0 for guests
router.use(optionalAuth);

// ── SSE helpers ──────────────────────────────────────────────────────

function sseWrite(res: Response, event: Record<string, any>): void {
  try {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (typeof (res as any).flush === "function") {
        (res as any).flush();
      }
    }
  } catch {
    // Connection closed — ignore
  }
}


// callGeminiText is imported from geminiRetry.ts — single shared implementation
// for all non-streaming Gemini calls across chat and diary modules.

// ── Run a single agent in chat mode ──────────────────────────────────

function buildNicknameInstruction(nickname: string): string {
  return nickname ? `使用者的暱稱是「${nickname}」，請在回應中用暱稱稱呼使用者。\n\n` : '';
}

function buildCustomInstructions(customInstructions: string): string {
  return customInstructions.trim()
    ? `使用者的自訂指示（請遵守）：\n${customInstructions.trim()}\n\n`
    : '';
}

async function runChatAgent(
  agent: AgentPersona,
  userMessage: string,
  contextStr: string,
  memoryStr: string,
  historyStr: string,
  assignedFocus: string,
  practicalIntent: boolean,
  _apiKey: string, // ignored — withStreamRetry handles key selection
  onEvent: (event: Record<string, any>) => void,
  imagePart?: string,
  nickname?: string,
  customInstructions?: string,
): Promise<{ agentId: string; result: string }> {
  onEvent({
    type: "agent-start",
    agentId: agent.id,
    agentName: agent.name,
    agentEmoji: agent.emoji,
    agentRole: agent.role,
  });

  const chatSystemPrompt = `${buildNicknameInstruction(nickname || '')}${buildCustomInstructions(customInstructions || '')}你是「${agent.name}」（${agent.role}），正在和其他 AI 好友一起回應使用者的訊息。

${agent.systemPrompt}

【對話模式注意事項】
- 你的回應會被整合到最終回覆中
- 保持簡短（2-3句話）
- 用對話的口吻，不要像報告
- 使用者的文字問題是主要意圖，必須優先回應文字問題
- 如果使用者同時上傳了圖片，圖片只是輔助資訊，不要讓圖片內容蓋過文字問題
- 如果使用者只傳圖片沒有文字，才以圖片內容為主
- 如果有相關資料被提供，引用它
- 你這一輪的分工是：${assignedFocus}
- 只專注在你被分配的角度，不要重複其他夥伴也會說的泛用建議
- 如果是規劃/待辦情境，只補你負責的那一塊，不要把整份計畫全部重講一次
- 如果內容涉及行程規劃、待辦事項、步驟整理或適合讓使用者直接複製貼上，優先用 markdown checklist 或 fenced code block 整理重點`;

  // Text question is the primary intent
  let prompt = `使用者的問題（主要回應目標）：${userMessage}`;
  if (isPlanningIntent(userMessage)) {
    prompt += `\n\n【回應要求】這是規劃/安排型需求。請先給具體可執行的下一步、可選方向或待辦拆解，不要只做情緒陪伴或空泛鼓勵。`;
  } else if (practicalIntent) {
    prompt += `\n\n【回應要求】這是實用解題/推薦需求。請直接給答案、建議、推薦或明確選項，不要只做情緒陪伴、感受探索或空泛鼓勵。`;
  }
  if (imagePart) prompt += `\n\n【使用者同時上傳了圖片（輔助資訊，不要忽視文字問題）】\n${imagePart}`;
  if (memoryStr) prompt += `\n\n【使用者跨對話記憶（僅供參考）】\n${memoryStr}`;
  if (contextStr) prompt += `\n\n【相關資料】\n${contextStr}`;
  if (historyStr) prompt += `\n\n【最近對話紀錄】\n${historyStr}`;

  let fullText = await callGeminiText(chatSystemPrompt, prompt, 1000, { maxRetries: 5, callType: "chat-agent", disableThinking: true });

  // Send the full result as a single "thinking" event
  if (fullText) {
    onEvent({
      type: "agent-thinking",
      agentId: agent.id,
      agentName: agent.name,
      agentEmoji: agent.emoji,
      content: fullText,
    });
  }

  onEvent({
    type: "agent-done",
    agentId: agent.id,
    agentName: agent.name,
    agentEmoji: agent.emoji,
    content: fullText,
  });

  return { agentId: agent.id, result: fullText };
}

// ── Master synthesis for chat ────────────────────────────────────────

const MASTER_CHAT_PROMPT = `你是心靈日記的 AI 助手，正在和使用者對話。多位 AI 好友已經各自分析了使用者的訊息。

請根據他們的分析，以及相關的資料庫搜尋結果，以每位好友的身份分別回覆。

規則：
- 繁體中文
- 每位好友各自用自己的口吻回應 1-3 句話
- 保持每位好友的個性和風格
- 如果有參考到使用者的日記或檔案，自然提及
- 各位好友之間不要重複同一件事；每位只保留自己最有價值、最不重複的角度
- 如果兩位好友觀點重疊，保留更貼近其角色的那位，另一位改補缺的面向
- 如果內容涉及行程規劃、待辦事項、步驟整理或適合讓使用者直接複製貼上，請優先用 markdown checklist 或 fenced code block 整理重點
- 輸出格式必須是：

{emoji} {名字}：[用該好友的口吻回應]

{emoji} {名字}：[用該好友的口吻回應]

（每位好友之間空一行）`;

const PLANNING_CHAT_PROMPT = `你是旅行與規劃助理。多位 AI 好友已經提供觀點，但你現在要直接幫使用者往前推進。

規則：
- 繁體中文
- 不要再用夥伴人格格式輸出
- 先給一版「可直接開始」的規劃，不要只講空泛鼓勵
- 缺資料時可以先做合理假設，但要明說你假設了什麼
- 優先輸出可執行內容：草案、待辦、下一步、可複製整理
- 內容務實、簡潔、有條理
- 先把多位夥伴的內容去重，再整合成一份不重複的規劃
- 同一件事只講一次；把不同夥伴的觀點合併成互補的待辦、風險與下一步

輸出格式：
## 先給你一版方向
<1-2 句，直接說明你怎麼先幫他規劃>

## 可直接開始的規劃
- [ ] ...
- [ ] ...

## 我先幫你假設
- ...

## 下一步我可以直接幫你做
1. ...
2. ...
3. ...`;

async function synthesizeChat(
  agentResults: Array<{ agentId: string; result: string }>,
  userMessage: string,
  contextStr: string,
  memoryStr: string,
  historyStr: string,
  onEvent: (event: Record<string, any>) => void,
  imagePart?: string,
  nickname?: string,
  conciseInstruction?: string,
): Promise<string> {
  onEvent({ type: "synthesizing", message: "🧠 整合回覆中..." });

  const analysisBlock = agentResults
    .map((r) => {
      const agent = AGENTS[r.agentId];
      return `【${agent.emoji} ${agent.name}（${agent.role}）的觀點】\n${r.result}`;
    })
    .join("\n\n");

  const agentFormatHint = agentResults
    .map((r) => {
      const agent = AGENTS[r.agentId];
      return `${agent.emoji} ${agent.name}`;
    })
    .join("、");

  let prompt = `使用者的問題（主要回應目標）：${userMessage}\n\n`;
  if (isPlanningIntent(userMessage)) {
    prompt += `【回應要求】這是規劃/安排型需求。整體回覆要優先提供具體方案、待辦清單、下一步或可直接複製的整理，不要只有情緒支持。\n\n`;
  }
  if (imagePart) prompt += `【使用者同時上傳了圖片（輔助資訊）】\n${imagePart}\n\n`;
  if (memoryStr) prompt += `【使用者跨對話記憶（僅供參考）】\n${memoryStr}\n\n`;
  if (contextStr) prompt += `【相關資料】\n${contextStr}\n\n`;
  if (historyStr) prompt += `【最近對話紀錄】\n${historyStr}\n\n`;
  prompt += `以下是各位好友的觀點：\n\n${analysisBlock}`;

  const isConciseReply = Boolean(conciseInstruction);
  if (isConciseReply) {
    prompt += `\n\n【輸出要求】${conciseInstruction}`;
    prompt += `\n請整合成一個最終答案，嚴格遵守格式要求。不要輸出 emoji、角色名、前言、解釋或多段回覆。`;
  } else {
    prompt += `\n\n請以這些好友的身份回覆（${agentFormatHint}），每位 1-3 句話，確保回應使用者的文字問題，且彼此不要重複相同建議。`;
  }

  const systemPrompt = isConciseReply
    ? buildNicknameInstruction(nickname || '') + '你是心靈日記的最終回答整理器。請根據使用者問題與多位好友的觀點，輸出單一最終答案。規則：繁體中文、嚴格遵守使用者格式要求、只輸出答案本身。'
    : buildNicknameInstruction(nickname || '') + MASTER_CHAT_PROMPT;

  const fullText = await callGeminiText(systemPrompt, prompt, 4096, { maxRetries: 5, callType: "chat-master", disableThinking: true, timeoutMs: 30000 });
  onEvent({ type: "synthesizing", content: fullText });
  return fullText;
}

async function synthesizePlanningChat(
  agentResults: Array<{ agentId: string; result: string }>,
  userMessage: string,
  contextStr: string,
  memoryStr: string,
  historyStr: string,
  onEvent: (event: Record<string, any>) => void,
  imagePart?: string,
  nickname?: string,
  conciseInstruction?: string,
): Promise<string> {
  onEvent({ type: "synthesizing", message: "🧭 整理規劃中..." });

  const analysisBlock = agentResults
    .map((r) => {
      const agent = AGENTS[r.agentId];
      return `【${agent.name}】\n${r.result}`;
    })
    .join("\n\n");

  let prompt = `使用者的規劃需求：${userMessage}\n\n`;
  if (imagePart) prompt += `【使用者同時上傳了圖片（輔助資訊）】\n${imagePart}\n\n`;
  if (memoryStr) prompt += `【使用者跨對話記憶（僅供參考）】\n${memoryStr}\n\n`;
  if (contextStr) prompt += `【相關資料】\n${contextStr}\n\n`;
  if (historyStr) prompt += `【最近對話紀錄】\n${historyStr}\n\n`;
  prompt += `以下是各位好友的規劃觀點：\n\n${analysisBlock}`;

  const isConciseReply = Boolean(conciseInstruction);
  if (isConciseReply) {
    prompt += `\n\n【輸出要求】${conciseInstruction}`;
    prompt += `\n請整合成單一最終答案，嚴格遵守格式要求。不要輸出 checklist、角色名、emoji 或額外解釋。`;
  }

  const systemPrompt = isConciseReply
    ? buildNicknameInstruction(nickname || '') + '你是規劃需求的最終回答整理器。請根據使用者需求與多位好友觀點，輸出一個最終答案。規則：繁體中文、嚴格遵守使用者格式要求、只輸出答案本身。'
    : buildNicknameInstruction(nickname || '') + PLANNING_CHAT_PROMPT;

  const fullText = await callGeminiText(systemPrompt, prompt, 2200, {
    maxRetries: 5,
    callType: "chat-planning-master",
    disableThinking: true,
    timeoutMs: 30000,
  });
  onEvent({ type: "synthesizing", content: fullText });
  return fullText;
}

async function synthesizePracticalAnswerChat(
  agentResults: Array<{ agentId: string; result: string }>,
  userMessage: string,
  contextStr: string,
  memoryStr: string,
  historyStr: string,
  onEvent: (event: Record<string, any>) => void,
  imagePart?: string,
  nickname?: string,
  conciseInstruction?: string,
): Promise<string> {
  onEvent({ type: 'synthesizing', message: '🎯 整理直接答案中...' });

  let prompt = `使用者現在要的是直接答案或推薦：${userMessage}\n\n`;
  if (imagePart) prompt += `【使用者同時上傳了圖片（輔助資訊）】\n${imagePart}\n\n`;
  if (memoryStr) prompt += `【使用者跨對話記憶（僅供參考）】\n${memoryStr}\n\n`;
  if (contextStr) prompt += `【相關資料】\n${contextStr}\n\n`;
  if (historyStr) prompt += `【最近對話紀錄】\n${historyStr}\n\n`;
  if (agentResults.length > 0) {
    const analysisBlock = agentResults
      .map((r) => {
        const agent = AGENTS[r.agentId];
        return `【${agent.name}】\n${r.result}`;
      })
      .join('\n\n');
    prompt += `以下是各位好友提供的解題觀點：\n\n${analysisBlock}`;
  }

  const isConciseReply = Boolean(conciseInstruction);
  if (isConciseReply) {
    prompt += `\n\n【輸出要求】${conciseInstruction}`;
    prompt += `\n請嚴格遵守格式要求，只輸出最終答案本身。`;
  } else {
    prompt += `\n\n請先直接回答使用者問題，不要再用多角色格式。`
      + ` 第一行必須先給出一個明確主推薦或結論。`
      + ` 若是吃飯/地點問題，優先給具體類型、區域或店家方向，不要只說「找最近的」這種空話。`
      + ` 若是 how-to 問題，直接給可執行步驟，不要先做情緒探索。`
      + ` 若是二選一問題，第一句就明確選其中一個。`
      + ` 之後最多補 2-3 個簡短理由、備選或判斷依據。`;
  }

  const systemPrompt = isConciseReply
    ? buildNicknameInstruction(nickname || '') + '你是實用問題的最終回答整理器。請根據使用者問題與多位好友觀點，直接輸出答案本身。規則：繁體中文、嚴格遵守格式要求、不要輸出角色名、emoji 或多段陪聊。'
    : buildNicknameInstruction(nickname || '') + '你是實用解題助理。你的任務是直接給出可用、可執行、具體的答案。規則：繁體中文、答案優先、第一句就給主結論、不要多角色格式、不要情緒陪聊蓋過解題、不要用空泛套話。';

  const fullText = await callGeminiText(systemPrompt, prompt, 1800, {
    maxRetries: 5,
    callType: 'chat-practical-master',
    disableThinking: true,
    timeoutMs: 30000,
  });
  onEvent({ type: 'synthesizing', content: fullText });
  return fullText;
}

async function synthesizePracticalFallbackDirect(
  userMessage: string,
  contextStr: string,
  memoryStr: string,
  historyStr: string,
  onEvent: (event: Record<string, any>) => void,
  imagePart?: string,
  nickname?: string,
  conciseInstruction?: string,
): Promise<string> {
  onEvent({ type: 'synthesizing', message: '🛟 改走直接答案保底中...' });

  let prompt = `使用者現在要的是直接答案或推薦：${userMessage}\n\n`;
  if (imagePart) prompt += `【使用者同時上傳了圖片（輔助資訊）】\n${imagePart}\n\n`;
  if (memoryStr) prompt += `【使用者跨對話記憶（僅供參考）】\n${memoryStr}\n\n`;
  if (contextStr) prompt += `【相關資料】\n${contextStr}\n\n`;
  if (historyStr) prompt += `【最近對話紀錄】\n${historyStr}\n\n`;

  if (conciseInstruction) {
    prompt += `【輸出要求】${conciseInstruction}\n請嚴格遵守格式要求，只輸出答案本身。`;
  } else {
    prompt += '請直接給可用答案，不要陪聊，不要角色格式，不要先反問。若資訊不足，可給一個主推薦和 1-2 個備選。';
  }

  const systemPrompt = conciseInstruction
    ? buildNicknameInstruction(nickname || '') + '你是實用問題的直接回答保底助手。請直接輸出答案本身，嚴格遵守格式要求，不要角色名與 emoji。'
    : buildNicknameInstruction(nickname || '') + '你是實用解題助理的保底模式。當多代理分析不可用時，你必須直接給使用者可執行答案。規則：繁體中文、答案優先、不要角色格式、不要情緒陪聊。';

  const fullText = await callGeminiText(systemPrompt, prompt, 1200, {
    maxRetries: 3,
    callType: 'chat-practical-fallback',
    disableThinking: true,
    timeoutMs: 20000,
  });
  onEvent({ type: 'synthesizing', content: fullText });
  return fullText;
}

function allAgentResultsUnavailable(agentResults: Array<{ agentId: string; result: string }>): boolean {
  return agentResults.every((result) => String(result.result || '').includes('（暫時無法回應）'));
}

function buildPracticalEmergencyResponse(userMessage: string): string {
  const text = String(userMessage || '');
  if (/火鍋|拉麵/.test(text)) return '直接選火鍋。它通常更有飽足感、選擇也比較多。';
  if (/早餐/.test(text)) return '早餐先選蛋餅加豆漿或飯糰這種穩定不踩雷的組合。';
  if (/午餐|晚餐|宵夜|吃什麼|吃甚麼|吃啥|餐廳|美食/.test(text)) return '先選一間離你最近、評價穩定、你平常就會吃的店，不要再耗在選擇上。';
  if (/去哪|去哪裡|散心|週末/.test(text)) return '先去一個移動成本低、能立刻出發的地方，例如附近公園、河堤、商場或咖啡店，重點是先出門。';
  if (/主管|溝通|談/.test(text)) return '先整理你的目標、事實和希望主管回應的具體內容，再約一個不被打擾的時間直接談。';
  return '先直接選一個最可行的方案執行，再視結果微調。';
}

function createClientAbortError(): Error {
  const error = new Error("client-aborted");
  error.name = "ClientAbortError";
  return error;
}

function isPlanningIntent(...inputs: Array<string | undefined>): boolean {
  const combined = inputs.filter(Boolean).join("\n");
  return /旅行|旅遊|行程|規劃|安排|韓國|日本|首爾|釜山|濟州|大阪|東京|京都|福岡|沖繩|出國|自由行|待辦|清單|計畫|沒有頭緒|沒頭緒/i.test(combined);
}

function extractLastUserMessage(historyStr?: string): string {
  const lines = String(historyStr || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith('使用者：')) {
      return lines[i].slice('使用者：'.length).trim();
    }
  }

  return '';
}

function extractRecentUserMessages(historyStr?: string, limit = 4): string[] {
  const lines = String(historyStr || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const users: string[] = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith('使用者：')) {
      users.push(lines[i].slice('使用者：'.length).trim());
      if (users.length >= limit) break;
    }
  }

  return users;
}

function isPracticalAnswerIntent(
  currentMessage: string,
  historyStr?: string,
): boolean {
  const current = String(currentMessage || '');
  const priorUserMessage = extractLastUserMessage(historyStr);
  const recentUserMessages = extractRecentUserMessages(historyStr, 4);
  const recommendationTopic = /晚餐|午餐|早餐|宵夜|吃什麼|吃甚麼|吃啥|餐廳|美食|哪家|哪裡吃|吃哪間|吃哪家|晚點吃什麼|推薦我去哪|去哪裡散心|去哪散心|週末去哪|週末推薦我去哪/i;
  const choiceTopic = /.+跟.+選一個|.+還是.+選一個|.+跟.+選哪個|.+或.+選哪個|.+還是.+選哪個|幫我選.+|替我選.+/i;
  const howToTopic = /怎麼跟.+溝通|怎麼和.+溝通|如何跟.+溝通|如何和.+溝通|怎麼跟.+談|怎麼和.+談|如何跟.+談|如何和.+談|.+怎麼談比較好|推薦我怎麼|建議我怎麼|直接告訴我怎麼|教我怎麼/i;
  const practicalTopic = new RegExp(`${recommendationTopic.source}|${choiceTopic.source}|${howToTopic.source}`, 'i');
  const answerPush = /給我答案|直接告訴我|直接回答|幫我選|替我選|選一個|就直接說|不要再問|直接說結論/i;
  const refinementPush = /預算低一點|便宜一點|不要排隊|近一點|近一些|近一點就好|不要太花錢|附理由|給理由|唯一答案|直接給唯一答案|只給一個|選最便宜的|選近一點的/i;
  const emotionalTopic = /焦慮|難過|委屈|失戀|沒胃口|心情很差|很亂|很煩|不知道怎麼辦|被罵|被羞辱|冷落/i;

  if (practicalTopic.test(current)) return true;
  if (answerPush.test(current) && practicalTopic.test(priorUserMessage)) return true;
  if (refinementPush.test(current)) {
    if (recentUserMessages.some((message) => emotionalTopic.test(message))) return false;
    if (recentUserMessages.some((message) => practicalTopic.test(message) || answerPush.test(message) || refinementPush.test(message))) {
      return true;
    }
  }
  return false;
}

function extractTravelDestination(userMessage: string): string {
  const match = userMessage.match(/韓國|日本|首爾|釜山|濟州|大阪|東京|京都|福岡|沖繩|巴黎|倫敦|曼谷|新加坡/);
  return match?.[0] || "這趟旅行";
}

function buildPlanningStarter(userMessage: string): string {
  const destination = extractTravelDestination(userMessage);
  return [
    "",
    "## 可直接開始的規劃",
    `- [ ] 先確認 ${destination} 要玩幾天、什麼時候去`,
    "- [ ] 先抓大概預算：機票 / 住宿 / 交通 / 吃喝 / 購物",
    "- [ ] 先決定旅遊節奏：悠閒、普通、還是排滿",
    "- [ ] 列出 3-5 個一定想去的點，先不要一次排滿",
    "",
    "```md",
    `目的地：${destination}`,
    "目前最缺：日期、天數、預算、想玩類型",
    "我下一步可以幫你：",
    "1. 先排一版輕鬆行程",
    "2. 幫你列規劃待辦",
    "3. 幫你整理還缺哪些資訊",
    "```",
  ].join("\n");
}

function getPlanningSelections(content: string) {
  const destination = extractTravelDestination(content);
  return {
    selections: [
      { agent: AGENTS.amu, reason: `把 ${destination} 旅行願望拆成可執行的規劃方向與下一步。` },
      { agent: AGENTS.jingjing, reason: `先補上旅遊規劃最容易卡住的風險與必要確認項。` },
      { agent: AGENTS.ajiao, reason: `當使用者說自己沒頭緒時，幫忙把焦慮拆成少量可處理的小步驟。` },
    ],
    summary: `這輪是旅行規劃情境，我優先邀請阿慕、驚驚、阿焦，直接把想法整理成下一步、風險確認與可執行待辦，而不是停在抽象鼓勵。`,
  };
}

function getPracticalSelections(content: string) {
  const target = /晚餐|午餐|早餐|宵夜|餐廳|美食|吃/.test(content) ? '吃飯選擇' : '這個實用問題';
  return {
    selections: [
      { agent: AGENTS.amu, reason: `把 ${target} 直接收斂成可執行的答案或選項。` },
      { agent: AGENTS.yanyan, reason: `替使用者淘汰普通選項，留下更值得直接採用的推薦。` },
      { agent: AGENTS.jingjing, reason: `補上踩雷風險、限制條件與快速判斷依據。` },
    ],
    summary: `這輪是實用解題情境，我優先邀請阿慕、厭厭、驚驚，直接把問題收斂成答案、推薦與快速判斷依據，而不是停在情緒陪聊。`,
  };
}

function buildIntentSummaryFromSelections(
  selections: Array<{ agent: AgentPersona; reason: string }>,
): string {
  if (selections.length === 0) return '這輪我邀請了幾位夥伴一起回應。';

  return `這輪我邀請了${selections.map((s) => s.agent.name).join('、')}，分別從不同角度補上不重複的回應：${selections
    .map((s) => `${s.agent.name}負責${s.reason || s.agent.role}`)
    .join('；')}`;
}

function buildConciseReplyInstruction(userMessage: string): string | null {
  const text = String(userMessage || '');
  const rules: string[] = [];
  const hasFollowupStructure = /(先|先用).*一句|一句.*(?:再|然後|之後)/.test(text);
  const asksForDirectAnswer = /(?:請|麻煩|幫我|直接|務必)*(?:用|以)?(?:一句話|一句)(?:直接)?(?:回答|回覆|講|說|輸出)|(?:請|麻煩|幫我|直接|務必)*(?:直接)?(?:回答|回覆|講|說|輸出).*?(?:用|以)?(?:一句話|一句)|\b(?:only answer|one sentence)\b/i.test(text);
  const asksForAnswerOnly = /(?:請|麻煩|幫我|直接)?(?:只回答|只回|只輸出)/.test(text);

  if (hasFollowupStructure && asksForDirectAnswer) {
    return '先用一句話直接回答，再依使用者要求補上必要內容；不要使用多角色格式。';
  }

  if (/只回答.*本身|只回.*本身|only answer/i.test(text)) {
    rules.push('只輸出答案本身。');
  } else if (asksForAnswerOnly) {
    rules.push('不要加額外說明。');
  }

  if (!hasFollowupStructure && asksForDirectAnswer) {
    rules.push('整體只用一句話。');
  }

  if (/(?:回答|回覆|輸出).*(?:不要加其他文字|不要其他文字|不要解釋|不要補充|不要前言)|(?:不要加其他文字|不要其他文字|不要解釋|不要補充|不要前言).*(?:回答|回覆|輸出)/i.test(text)) {
    rules.push('不要加任何額外文字、角色名、emoji、條列或解釋。');
  }

  if (/只回答代號|只回答答案|只回答名稱|只回代號|只回答案|只回名稱/.test(text)) {
    rules.push('如果答案是代號、名稱或短詞，只輸出該字串本身。');
  }

  return rules.length > 0 ? rules.join(' ') : null;
}

function extractStrictShortAnswer(text: string): string {
  const cleaned = String(text || '').trim();

  const leadingToken = cleaned.match(/^([A-Za-z0-9_-]{2,})(?:[，,。.!?\s]|$)/);
  if (leadingToken?.[1]) return leadingToken[1].trim();

  const named = cleaned.match(/(?:答案是|答案為|名稱是|代號是|代號|名稱)\s*([A-Za-z0-9_\-\u4e00-\u9fff]+)/);
  if (named?.[1]) return named[1].trim();

  const quoted = cleaned.match(/[「『"]([^」』"]+)[」』"]/);
  if (quoted?.[1]) return quoted[1].trim();

  const token = cleaned.match(/[A-Za-z0-9_-]{2,}/g)?.[0];
  if (token) return token;

  return '';
}

function sanitizeConciseFallbackAnswer(text: string, conciseInstruction: string): string {
  let cleaned = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[^\s]+\s+[^\s：:]+[：:]\s*/, '').replace(/^[-*]\s*/, '').trim())
    .find(Boolean) || '';

  if (/代號|名稱|本身/.test(conciseInstruction)) {
    const strict = extractStrictShortAnswer(cleaned);
    if (strict) return strict;

    const firstClause = cleaned
      .replace(/^(?:答案是|名稱是|代號是|我會選|我選|選擇|選|就是|是)\s*/g, '')
      .split(/[，。,；;！？!?]/)[0]
      ?.trim();
    if (firstClause) return firstClause;
  }

  if (/一句話|一句/.test(conciseInstruction)) {
    cleaned = cleaned.split(/[。！？!?]/)[0]?.trim() || cleaned;
    cleaned = cleaned.replace(/[，,；;].*$/, '').trim();
    if (cleaned && !/[。！？!?]$/.test(cleaned) && !/代號|名稱|本身/.test(conciseInstruction)) {
      cleaned += '。';
    }
  }

  if (/只輸出答案本身|不要加額外說明/.test(conciseInstruction)) {
    cleaned = cleaned.replace(/[，,；;].*$/, '').trim();
  }

  return cleaned;
}

function buildConciseFallbackResponse(
  agentResults: Array<{ agentId: string; result: string }>,
  conciseInstruction: string,
): string {
  if (/代號|名稱|本身/.test(conciseInstruction)) {
    for (const result of agentResults) {
      const strict = extractStrictShortAnswer(result.result);
      if (strict) return strict;
    }
  }

  for (const result of agentResults) {
    const candidate = sanitizeConciseFallbackAnswer(result.result, conciseInstruction);
    if (candidate) return candidate;
  }

  return '（暫時無法回應）';
}

function getOwnedChatFolder(folderId: unknown, userId: number) {
  if (folderId === undefined) return undefined;
  if (folderId === null) return null;

  const parsed = Number(folderId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return false;
  }

  const folder = sqlite
    .prepare("SELECT id FROM chat_folders WHERE id = ? AND user_id = ?")
    .get(parsed, userId) as { id: number } | undefined;

  return folder ? parsed : false;
}

function buildFallbackChatResponse(
  agentResults: Array<{ agentId: string; result: string }>
): string {
  return agentResults
    .map((result) => {
      const agent = AGENTS[result.agentId];
      const name = agent?.name || result.agentId;
      const emoji = agent?.emoji || "🤖";
      const text = result.result?.trim() || "（暫時無法回應）";
      return `${emoji} ${name}：${text}`;
    })
    .join("\n\n");
}

function buildFallbackSessionTitle(content: string): string {
  return content.slice(0, 20) + (content.length > 20 ? '...' : '');
}

function updateSessionTitleInBackground(params: {
  sessionId: number;
  content: string;
  aiResponse: string;
  fallbackTitle: string;
}): void {
  const { sessionId, content, aiResponse, fallbackTitle } = params;

  void (async () => {
    try {
      const titleContext = `使用者：${content.slice(0, 300)}\n\nAI 回覆：${aiResponse.slice(0, 500)}`;
      const aiTitle = await callGeminiText(
        '你是標題生成助手。根據對話內容，生成一個簡短的繁體中文標題（10字以內，不要加引號或標點）。標題要反映對話的實質內容（例如：討論的主題、物品、事件），不要直接照抄使用者的原話。只回傳標題本身。',
        titleContext,
        32,
        {
          maxRetries: 1,
          callType: 'chat-title',
          disableThinking: true,
          timeoutMs: 8000,
        },
      );

      const cleanTitle = aiTitle
        .trim()
        .replace(/^[「『"']+|[」』"']+$/g, '')
        .trim()
        .slice(0, 30);

      if (cleanTitle) {
        sqlite.prepare("UPDATE chat_sessions SET title = ? WHERE id = ? AND title = ?").run(cleanTitle, sessionId, fallbackTitle);
      }
    } catch (titleErr) {
      console.error('[chat-title] Background title generation failed:', (titleErr as Error).message);
    }
  })();
}

// ── Chat Folders CRUD ────────────────────────────────────────────────

// GET /api/chat/folders
router.get("/folders", (req: Request, res: Response) => {
  try {
    const folders = sqlite
      .prepare("SELECT * FROM chat_folders WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC")
      .all(req.userId);
    res.json({ folders });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// POST /api/chat/folders
router.post("/folders", requireAuth, (req: Request, res: Response) => {
  try {
    const { name, icon } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "名稱不能為空" });
    const result = sqlite.prepare("INSERT INTO chat_folders (name, icon, user_id) VALUES (?, ?, ?)").run(name.trim(), icon || '💬', req.userId);
    const folder = sqlite.prepare("SELECT * FROM chat_folders WHERE id = ? AND user_id = ?").get(result.lastInsertRowid, req.userId);
    res.status(201).json(folder);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "建立失敗" });
  }
});

// PUT /api/chat/folders/:id
router.put("/folders/:id", requireAuth, (req: Request, res: Response) => {
  try {
    const { name, icon } = req.body;
    const id = Number(req.params.id);
    const result = sqlite
      .prepare("UPDATE chat_folders SET name = COALESCE(?, name), icon = COALESCE(?, icon) WHERE id = ? AND user_id = ?")
      .run(name || null, icon || null, id, req.userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: "資料夾不存在" });
    }
    const folder = sqlite.prepare("SELECT * FROM chat_folders WHERE id = ? AND user_id = ?").get(id, req.userId);
    res.json(folder);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "更新失敗" });
  }
});

// DELETE /api/chat/folders/:id
router.delete("/folders/:id", requireAuth, (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const folder = sqlite
      .prepare("SELECT id FROM chat_folders WHERE id = ? AND user_id = ?")
      .get(id, req.userId);
    if (!folder) {
      return res.status(404).json({ error: "資料夾不存在" });
    }
    sqlite.prepare("UPDATE chat_sessions SET folder_id = NULL WHERE folder_id = ? AND user_id = ?").run(id, req.userId);
    sqlite.prepare("DELETE FROM chat_folders WHERE id = ? AND user_id = ?").run(id, req.userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

// ── Sessions CRUD ────────────────────────────────────────────────────

// POST /api/chat/sessions — create new session
router.post("/sessions", (req: Request, res: Response) => {
  try {
    const title = req.body.title || "新對話";
    const folderOwnership = getOwnedChatFolder(req.body.folder_id, req.userId);
    if (folderOwnership === false) {
      return res.status(400).json({ error: "無效的對話資料夾" });
    }
    const folderId = folderOwnership === undefined ? null : folderOwnership;
    const result = sqlite
      .prepare("INSERT INTO chat_sessions (title, folder_id, user_id) VALUES (?, ?, ?)")
      .run(title, folderId, req.userId);

    const session = sqlite
      .prepare("SELECT * FROM chat_sessions WHERE id = ?")
      .get(result.lastInsertRowid);

    res.status(201).json(session);
  } catch (err: any) {
    console.error("[chat] Create session error:", err);
    res.status(500).json({ error: err.message || "建立失敗" });
  }
});

// PUT /api/chat/sessions/:id — update session (title, folder)
router.put("/sessions/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { title, folder_id } = req.body;
    const folderOwnership = getOwnedChatFolder(folder_id, req.userId);
    if (folderOwnership === false) {
      return res.status(400).json({ error: "無效的對話資料夾" });
    }
    if (folderOwnership === undefined) {
      sqlite.prepare("UPDATE chat_sessions SET title = COALESCE(?, title) WHERE id = ? AND user_id = ?")
        .run(title || null, id, req.userId);
    } else {
      sqlite.prepare("UPDATE chat_sessions SET title = COALESCE(?, title), folder_id = ? WHERE id = ? AND user_id = ?")
        .run(title || null, folderOwnership, id, req.userId);
    }
    const session = sqlite.prepare("SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?").get(id, req.userId);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "更新失敗" });
  }
});

// GET /api/chat/sessions — list sessions with last message preview
router.get("/sessions", (req: Request, res: Response) => {
  try {
    const folderId = req.query.folder_id;
    let query = `SELECT s.*,
          (SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY id DESC LIMIT 1) as last_message,
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count
        FROM chat_sessions s
        WHERE s.user_id = ?`;
    const params: any[] = [req.userId];

    if (folderId === 'null') {
      query += " AND s.folder_id IS NULL";
    } else if (folderId) {
      query += " AND s.folder_id = ?";
      params.push(Number(folderId));
    }

    query += " ORDER BY s.created_at DESC";
    const sessions = sqlite.prepare(query).all(...params);

    res.json({ sessions });
  } catch (err: any) {
    console.error("[chat] List sessions error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// DELETE /api/chat/sessions/:id — delete session and all messages
router.delete("/sessions/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const session = sqlite
      .prepare("SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?")
      .get(id, req.userId);

    if (!session) {
      return res.status(404).json({ error: "對話不存在" });
    }

    // Delete messages first, then session
    sqlite
      .prepare("DELETE FROM chat_messages WHERE session_id = ?")
      .run(id);
    sqlite.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);

    res.json({ success: true });
  } catch (err: any) {
    console.error("[chat] Delete session error:", err);
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

// ── POST /api/chat/sessions/:id/messages — SSE streaming multi-agent ─

router.post(
  "/sessions/:id/messages",
  chatImageUpload.single("image"),
  async (req: Request, res: Response) => {
    const sessionId = Number(req.params.id);
    const content = req.body.content || '';

    if (!content && !req.file) {
      return res.status(400).json({ error: "訊息內容不能為空" });
    }

    // Verify session exists and belongs to current user
    const session = sqlite
      .prepare("SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?")
      .get(sessionId, req.userId) as { id: number; title: string } | undefined;

    if (!session) {
      return res.status(404).json({ error: "對話不存在" });
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    if ((res as any).socket) (res as any).socket.setNoDelay(true);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
      if (typeof (res as any).flush === "function") {
        (res as any).flush();
      }
    }, 15000);

    // Handle client disconnect — use res.on('close') not req.on('close'):
    // req 'close' fires when the request body is consumed (immediately after POST body is read),
    // whereas res 'close' fires only when the actual TCP connection drops.
    let aborted = false;
    res.on("close", () => {
      aborted = true;
      clearInterval(heartbeat);
    });

    const ensureClientConnected = () => {
      if (aborted) {
        throw createClientAbortError();
      }
    };

    const sendEvent = (event: Record<string, any>) => {
      if (!aborted) sseWrite(res, event);
    };

    let userMessageId: number | null = null;
    let assistantSaved = false;

    try {
      // 1. Save user message (with image_url if uploaded)
      const imageUrl = req.file
        ? `/images/chat/${path.basename(req.file.path)}`
        : null;

      const userInsert = sqlite
        .prepare(
          "INSERT INTO chat_messages (session_id, role, content, image_url) VALUES (?, 'user', ?, ?)"
        )
        .run(sessionId, content, imageUrl);
      userMessageId = Number(userInsert.lastInsertRowid);

      ensureClientConnected();

      // Check if this is the first message — title will be generated after AI responds
      const msgCount = (
        sqlite
          .prepare(
            "SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?"
          )
          .get(sessionId) as { count: number }
      ).count;
      const isFirstMessage = msgCount === 1;
      const fallbackSessionTitle = buildFallbackSessionTitle(content);
      if (isFirstMessage) {
        sqlite.prepare("UPDATE chat_sessions SET title = ? WHERE id = ?").run(fallbackSessionTitle, sessionId);
      }
      const sessionMeta = sqlite
        .prepare("SELECT title FROM chat_sessions WHERE id = ? AND user_id = ?")
        .get(sessionId, req.userId) as { title: string } | undefined;

      // 2. Search FTS5 for relevant context
      sendEvent({ type: "phase", phase: "searching", message: "搜尋相關資料..." });

      let imagePart = ""; // image analysis stored separately to preserve intent priority
      let contextParts: string[] = [];

      try {
        const fileResults = sqlite
          .prepare(
            `SELECT f.filename, f.ai_summary, snippet(files_fts, 0, '**', '**', '...', 32) as snippet
            FROM files_fts
            JOIN files f ON f.id = files_fts.rowid
            WHERE files_fts MATCH ? AND f.user_id = ?
            ORDER BY rank
            LIMIT 3`
          )
          .all(content, req.userId) as any[];

        for (const r of fileResults) {
          contextParts.push(
            `[檔案: ${r.filename}] ${r.ai_summary || r.snippet}`
          );
        }
      } catch {
        // FTS match might fail on certain queries; ignore
      }

      try {
        const diaryResults = sqlite
          .prepare(
            `SELECT d.title, snippet(diary_fts, 1, '**', '**', '...', 32) as snippet
            FROM diary_fts
            JOIN diary_entries d ON d.id = diary_fts.rowid
            WHERE diary_fts MATCH ? AND d.user_id = ?
            ORDER BY rank
            LIMIT 3`
          )
          .all(content, req.userId) as any[];

        for (const r of diaryResults) {
          contextParts.push(`[日記: ${r.title}] ${r.snippet}`);
        }
      } catch {
        // FTS match might fail; ignore
      }

      // Analyze uploaded image (if any) — kept separate so text question stays primary intent
      if (req.file) {
        sendEvent({ type: "phase", phase: "analyzing-image", message: "分析圖片中..." });
        try {
          ensureClientConnected();
          const imgBuffer = fs.readFileSync(req.file.path);
          const imgTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("image analysis timeout")), 60000)
          );
          const imgResult = await Promise.race([
            analyzeImage(
              imgBuffer,
              req.file.mimetype,
              "請詳細描述這張圖片的內容，包括主要元素、色彩、文字、情境等所有細節。"
            ),
            imgTimeout,
          ]);
          ensureClientConnected();
          imagePart = imgResult.text;
        } catch (imgErr) {
          if ((imgErr as Error)?.name === "ClientAbortError") throw imgErr;
          console.error("[chat] Image analysis failed:", imgErr);
          imagePart = "（圖片分析失敗）";
        }
      }

      const contextStr =
        contextParts.length > 0 ? contextParts.join("\n\n") : "";

      // 3. Get conversation history (last 5 messages for context)
      const history = sqlite
        .prepare(
          "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 10"
        )
        .all(sessionId) as Array<{ role: string; content: string }>;

      // Reverse to chronological order and format
      const historyStr = history
        .reverse()
        .slice(0, -1) // exclude the just-inserted user message (it's the prompt)
        .map((m) => `${m.role === "user" ? "使用者" : "助手"}：${m.content}`)
        .join("\n");
      const planningIntent = isPlanningIntent(content, historyStr, sessionMeta?.title);
      const practicalIntent = !planningIntent && isPracticalAnswerIntent(content, historyStr);
      const conciseInstruction = buildConciseReplyInstruction(content);

      const memoryStr = req.userId ? formatUserMemories(req.userId) : "";

      // 4. AI-based agent selection with reasoning
      ensureClientConnected();
      sendEvent({ type: "phase", phase: "analyzing", message: "AI 分析訊息，選擇最適合的好友..." });

      // Build agent selection input — text question is primary intent, image is auxiliary
      let selectionInput = `使用者的問題（主要意圖）：${content}`;
      if (sessionMeta?.title) selectionInput += `\n\n當前對話標題：${sessionMeta.title}`;
      if (historyStr) selectionInput += `\n\n最近對話脈絡：\n${historyStr}`;
      if (imagePart) selectionInput += `\n\n【使用者同時上傳了圖片（輔助資訊）】\n${imagePart}`;
      if (memoryStr) selectionInput += `\n\n使用者跨對話記憶（僅供參考）：\n${memoryStr}`;
      if (contextStr) selectionInput += `\n\n相關背景資料：\n${contextStr}`;

      const { selections, summary: rawSelectionSummary } = planningIntent
        ? getPlanningSelections(`${sessionMeta?.title || ''}\n${historyStr}\n${content}`)
        : practicalIntent
        ? getPracticalSelections(`${sessionMeta?.title || ''}\n${historyStr}\n${content}`)
        : await selectAgentsWithAI(selectionInput, 3);
      const selectionSummary = planningIntent || practicalIntent
        ? rawSelectionSummary
        : buildIntentSummaryFromSelections(selections);
      ensureClientConnected();

      // Build intent data from AI selections
      const reasonsMap: Record<string, string> = {};
      for (const s of selections) {
        reasonsMap[s.agent.id] = s.reason;
      }

      const intentAgents = practicalIntent
        ? []
        : selections.map((s) => ({
            id: s.agent.id,
            name: s.agent.name,
            emoji: s.agent.emoji,
            role: s.agent.role,
            reason: s.reason,
          }));

      sendEvent({
        type: "intent",
        agents: intentAgents,
        reasons: practicalIntent ? {} : reasonsMap,
        summary: selectionSummary,
      });

      const selectedAgents = selections
        .map((s) => s.agent)
        .filter((agent, index, agents) => agents.findIndex((candidate) => candidate.id === agent.id) === index);
      const intentResult = {
        agents: practicalIntent ? [] : selections.map((s) => ({ id: s.agent.id, reason: s.reason })),
        summary: selectionSummary,
      };

      sendEvent({
        type: "phase",
        phase: "thinking",
        message: practicalIntent ? '直接整理可用答案' : `派出 ${selectedAgents.length} 位好友討論`,
        agents: practicalIntent
          ? []
          : selectedAgents.map((a) => ({
              id: a.id,
              name: a.name,
              emoji: a.emoji,
              role: a.role,
            })),
      });

      // Look up user nickname and custom_instructions for personalized AI responses
      const chatUserData = sqlite.prepare("SELECT nickname, custom_instructions FROM users WHERE id = ?").get(req.userId) as { nickname: string; custom_instructions: string } | undefined;
      const userNickname = chatUserData?.nickname || '';
      const userCustomInstructions = chatUserData?.custom_instructions || '';

      // 5. Run agents in parallel for reflective/planning chats only.
      // Practical-answer mode should prioritize a stable direct answer instead of depending on all agent calls.
      ensureClientConnected();
      const agentResults = practicalIntent
        ? []
        : await Promise.all(
            selectedAgents.map((agent) => {
              return runChatAgent(
                agent,
                content,
                contextStr,
                memoryStr,
                historyStr,
                reasonsMap[agent.id] || `${agent.name} 補這輪最需要的獨特角度。`,
                practicalIntent,
                "",
                sendEvent,
                imagePart || undefined,
                userNickname,
                userCustomInstructions,
              ).catch((err) => {
                console.error(`[chat] Agent ${agent.id} failed:`, err);
                sendEvent({
                  type: "agent-done",
                  agentId: agent.id,
                  agentName: agent.name,
                  agentEmoji: agent.emoji,
                  content: "（暫時無法回應）",
                });
                return { agentId: agent.id, result: "（暫時無法回應）" };
              });
            }),
          );
      ensureClientConnected();

      // Always continue to synthesis + save, even if client disconnected
      // (so the response is stored in DB for next page load)
      sendEvent({
        type: "phase",
        phase: "synthesizing",
        message: "整合回覆中...",
      });

      let aiResponse: string;
      try {
        aiResponse = planningIntent
          ? await synthesizePlanningChat(
              agentResults,
              content,
              contextStr,
              memoryStr,
              historyStr,
              sendEvent,
              imagePart || undefined,
              userNickname,
              conciseInstruction || undefined,
            )
          : practicalIntent
          ? await synthesizePracticalAnswerChat(
              agentResults,
              content,
              contextStr,
              memoryStr,
              historyStr,
              sendEvent,
              imagePart || undefined,
              userNickname,
              conciseInstruction || undefined,
            )
          : await synthesizeChat(
              agentResults,
              content,
              contextStr,
              memoryStr,
              historyStr,
              sendEvent,
              imagePart || undefined,
              userNickname,
              conciseInstruction || undefined,
            );
      } catch (synthesisErr: any) {
        console.error("[chat] Synthesis failed, using fallback:", synthesisErr);
        if (practicalIntent) {
          try {
            aiResponse = await synthesizePracticalFallbackDirect(
              content,
              contextStr,
              memoryStr,
              historyStr,
              sendEvent,
              imagePart || undefined,
              userNickname,
              conciseInstruction || undefined,
            );
          } catch (practicalFallbackErr) {
            console.error('[chat] Practical fallback synthesis failed:', practicalFallbackErr);
            aiResponse = conciseInstruction
              ? buildPracticalEmergencyResponse(content)
              : buildPracticalEmergencyResponse(content);
            sendEvent({ type: 'synthesizing', content: aiResponse });
          }
        } else {
          aiResponse = conciseInstruction
            ? buildConciseFallbackResponse(agentResults, conciseInstruction)
            : buildFallbackChatResponse(agentResults);
          sendEvent({ type: 'synthesizing', content: aiResponse });
        }
      }

      if (planningIntent && !conciseInstruction && !/^- \[(?: |x|X)\]/m.test(aiResponse)) {
        aiResponse = `${aiResponse.trim()}\n${buildPlanningStarter(content)}`;
      }

      // 6.5 Generate/refine AI title out-of-band so the chat response is not blocked.
      if (isFirstMessage) {
        updateSessionTitleInBackground({ sessionId, content, aiResponse, fallbackTitle: fallbackSessionTitle });
      }

      // 7. Save assistant message with ai_agents and dispatch_reason
      // Include agent text so thinking can be reconstructed on reload
      const agentTextMap: Record<string, string> = {};
      for (const r of agentResults) agentTextMap[r.agentId] = r.result;

      const aiAgentsJson = JSON.stringify(
        intentResult.agents.map((a) => {
          const agent = AGENTS[a.id];
          return {
            id: a.id,
            name: agent?.name || a.id,
            emoji: agent?.emoji || "🤖",
            role: agent?.role || "",
            reason: a.reason,
            text: agentTextMap[a.id] || "",
          };
        })
      );
      const dispatchReason = intentResult.summary;

      const result = sqlite
        .prepare(
          "INSERT INTO chat_messages (session_id, role, content, ai_agents, dispatch_reason) VALUES (?, 'assistant', ?, ?, ?)"
        )
        .run(sessionId, aiResponse, aiAgentsJson, dispatchReason);
      assistantSaved = true;

      const assistantMessage = sqlite
        .prepare("SELECT * FROM chat_messages WHERE id = ?")
        .get(result.lastInsertRowid) as {
        id: number;
        role: string;
        content: string;
        ai_agents: string | null;
        dispatch_reason: string | null;
        created_at: string;
      };

      // 8. Also fetch the saved user message to get its DB id (replaces temp)
      const userMessage = sqlite
        .prepare(
          "SELECT id, role, content, image_url, created_at FROM chat_messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1"
        )
        .get(sessionId) as { id: number; role: string; content: string; image_url: string | null; created_at: string } | undefined;

      let memoryUpdated = false;
      try {
        memoryUpdated = await extractAndStoreUserMemories({
          userId: req.userId || 0,
          sessionId,
          sourceMessageId: userMessage?.id ?? null,
          userMessage: content,
          assistantMessage: aiResponse,
          historyStr,
          existingMemoryStr: memoryStr,
        });
      } catch (memoryErr) {
        console.error("[chat] User memory extraction failed:", memoryErr);
      }

      // 9. Stream complete event
      sendEvent({
        type: "complete",
        userMessage: userMessage
          ? { id: userMessage.id, role: userMessage.role, content: userMessage.content, image_url: userMessage.image_url, created_at: userMessage.created_at }
          : undefined,
        message: {
          id: assistantMessage.id,
          role: assistantMessage.role,
          content: assistantMessage.content,
          ai_agents: assistantMessage.ai_agents,
          dispatch_reason: assistantMessage.dispatch_reason,
          created_at: assistantMessage.created_at,
        },
        memoryUpdated,
        titlePending: isFirstMessage,
      });
    } catch (err: any) {
      if (err?.name === "ClientAbortError" || err?.message === "client-aborted") {
        console.warn("[chat] Client aborted in-flight chat request");
      } else {
        console.error("[chat] SSE message error:", err);
        sendEvent({
          type: "error",
          message: err.message || "處理訊息時發生錯誤",
        });
      }
    } finally {
      clearInterval(heartbeat);
      if (aborted && userMessageId && !assistantSaved) {
        sqlite.prepare("DELETE FROM chat_messages WHERE id = ? AND role = 'user'").run(userMessageId);
        if (req.file?.path) {
          try { fs.unlinkSync(req.file.path); } catch {}
        }
      }
      if (!aborted) res.end();
    }
  }
);

// GET /api/chat/sessions/:id/messages — get all messages in session
router.get("/sessions/:id/messages", (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.id);

    const session = sqlite
      .prepare("SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?")
      .get(sessionId, req.userId);

    if (!session) {
      return res.status(404).json({ error: "對話不存在" });
    }

    const messages = sqlite
      .prepare(
        "SELECT id, session_id, role, content, image_url, ai_agents, dispatch_reason, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC"
      )
      .all(sessionId);

    res.json({ messages });
  } catch (err: any) {
    console.error("[chat] Get messages error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

export default router;
