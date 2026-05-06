import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AgentPersona } from './agents.js';
import { withGeminiRetry } from './geminiRetry.js';
import { trackUsageByKey } from './pool.js';

export type ChatResponseMode =
  | 'reflective'
  | 'planning'
  | 'practical'
  | 'directive_advice'
  | 'support_action';

export interface ChatIntentSelection {
  id: string;
  reason: string;
}

export interface ChatIntentAnalysis {
  responseMode: ChatResponseMode;
  selected: ChatIntentSelection[];
  summary: string;
  reason: string;
  confidence: number;
  safetyConcern: 'none' | 'self_harm' | 'harm_others' | 'medical_urgent';
}

interface AnalyzeChatIntentParams {
  currentMessage: string;
  historyStr: string;
  sessionTitle?: string;
  memoryStr?: string;
  contextStr?: string;
  imagePart?: string;
  availableAgents: AgentPersona[];
}

const RESPONSE_MODES: ChatResponseMode[] = [
  'reflective',
  'planning',
  'practical',
  'directive_advice',
  'support_action',
];

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function normalizeSafetyConcern(value: unknown): ChatIntentAnalysis['safetyConcern'] {
  if (value === 'self_harm' || value === 'harm_others' || value === 'medical_urgent') return value;
  return 'none';
}

function normalizeMode(value: unknown): ChatResponseMode | null {
  return RESPONSE_MODES.includes(value as ChatResponseMode) ? (value as ChatResponseMode) : null;
}

function buildChatIntentSystemPrompt(availableAgents: AgentPersona[]): string {
  const agentList = availableAgents
    .map((agent) => `- ${agent.id}（${agent.name}，${agent.role}）：${agent.description}`)
    .join('\n');

  return `你是「心靈日記」的對話意圖總分析器。你的任務不是用關鍵字分類，而是先理解使用者目前真正需要什麼，再決定回覆模式與需要哪些夥伴。

可用夥伴：
${agentList}

請只回傳 JSON，不要有其他文字：
{
  "responseMode": "reflective | planning | practical | directive_advice | support_action",
  "selected": [
    { "id": "agent_id", "reason": "為什麼這位夥伴適合本輪，需對應使用者具體情境" }
  ],
  "summary": "繁體中文，一句話說明你如何判斷本輪需要的幫助",
  "reason": "繁體中文，簡短說明判斷依據，不要只引用關鍵字",
  "confidence": 0.0,
  "safetyConcern": "none | self_harm | harm_others | medical_urgent"
}

responseMode 定義：
- reflective：使用者主要想被聽見、整理感受、自我覺察；沒有明確要立即處理的外部問題，或明確說「不要給建議 / 只想被聽」。
- planning：使用者在做旅行、行程、任務、待辦、未來安排，或前文已是規劃脈絡而本輪是 follow-up。
- practical：使用者要推薦、比較、二選一、how-to、直接答案或對上一輪實用答案做條件 refinement。
- directive_advice：使用者在情緒脈絡中明確要求不要安慰、直接給建議、直接給方法或直接說怎麼做。
- support_action：使用者情緒明顯很糟，而且有一個眼前問題需要處理；需要先穩住情緒，再給可執行下一步。自傷、傷人或急性身體風險也歸這類。

判斷規則：
- 一定要看「目前訊息 + 最近對話 + 對話標題」，不要只看最後一句。
- 「我很焦慮，不知道怎麼辦」如果沒有具體外部問題，通常是 reflective，不要硬轉 practical。
- 「我被主管當眾否定，心情很糟，不知道怎麼辦」是 support_action，因為有具體問題需要處理。
- 「我想去韓國玩」「我沒有頭緒」「幫我排一版」在同一脈絡都應是 planning。
- 「火鍋或拉麵選哪個」「怎麼跟主管談比較好」是 practical，第一句就要能給答案或步驟。
- 如果使用者明確說「只想被聽」「不要給建議」，即使很難過也選 reflective。
- practical 與 directive_advice 模式通常 selected 回傳空陣列，因為後續會直接合成答案；其他模式請選 2-3 位互補夥伴。
- selected 只能使用上方夥伴 id，不可自創。`;
}

function parseChatIntent(raw: string, validAgentIds: Set<string>): ChatIntentAnalysis | null {
  const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
  const responseMode = normalizeMode(parsed.responseMode);
  if (!responseMode) return null;

  const selected: ChatIntentSelection[] = [];
  const seen = new Set<string>();
  const rawSelected = Array.isArray(parsed.selected) ? parsed.selected : [];
  for (const item of rawSelected) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const id = String(candidate.id || '').trim();
    if (!validAgentIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    selected.push({ id, reason: String(candidate.reason || '').trim() });
    if (selected.length >= 3) break;
  }

  return {
    responseMode,
    selected,
    summary: String(parsed.summary || '').trim(),
    reason: String(parsed.reason || '').trim(),
    confidence: clampConfidence(parsed.confidence),
    safetyConcern: normalizeSafetyConcern(parsed.safetyConcern),
  };
}

export async function analyzeChatIntentWithAI({
  currentMessage,
  historyStr,
  sessionTitle,
  memoryStr,
  contextStr,
  imagePart,
  availableAgents,
}: AnalyzeChatIntentParams): Promise<ChatIntentAnalysis | null> {
  const systemPrompt = buildChatIntentSystemPrompt(availableAgents);
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const validAgentIds = new Set(availableAgents.map((agent) => agent.id));

  let prompt = `目前使用者訊息：${currentMessage}`;
  if (sessionTitle) prompt += `\n\n對話標題：${sessionTitle}`;
  if (historyStr) prompt += `\n\n最近對話：\n${historyStr}`;
  if (memoryStr) prompt += `\n\n跨對話記憶（僅供判斷，不是事實來源）：\n${memoryStr}`;
  if (contextStr) prompt += `\n\n相關資料：\n${contextStr}`;
  if (imagePart) prompt += `\n\n圖片描述（輔助，文字仍是主要意圖）：\n${imagePart}`;

  try {
    const raw = await withGeminiRetry(
      async (apiKey) => {
        const genai = new GoogleGenerativeAI(apiKey);
        const model = genai.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt,
          generationConfig: {
            maxOutputTokens: 768,
            responseMimeType: 'application/json',
            // @ts-expect-error — thinkingBudget:0 avoids truncated JSON on Gemini 2.5 models.
            thinkingConfig: { thinkingBudget: 0 },
          },
        });
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('chat intent analysis timeout')), 20000),
        );
        const response = await Promise.race([
          model.generateContent(prompt.slice(0, 5000)),
          timeout,
        ]);
        const usage = response.response.usageMetadata;
        if (usage) {
          trackUsageByKey(
            apiKey,
            modelName,
            usage.promptTokenCount || 0,
            usage.candidatesTokenCount || 0,
            'chat-intent-analysis',
          );
        }
        return response.response.text();
      },
      { maxRetries: 3, callType: 'chat-intent-analysis' },
    );

    return parseChatIntent(raw, validAgentIds);
  } catch (err) {
    console.warn('[chatIntentAnalyzer] AI intent analysis failed:', err);
    return null;
  }
}
