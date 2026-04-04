import { AGENTS, MASTER_AGENT_PROMPT, AgentPersona } from './agents.js';
import { withGeminiRetry } from './geminiRetry.js';
import { assignBatchKeys, trackUsageByKey } from './keyPool.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface AnalysisEvent {
  type: 'phase' | 'agent-start' | 'agent-thinking' | 'agent-done' | 'synthesizing' | 'done' | 'error' | 'tags' | 'intent';
  phase?: string;
  message?: string;
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  agentRole?: string;
  content?: string;
  tags?: string[];
  reflection?: string;
  agents?: Array<{ id: string; name: string; emoji: string; role: string; reason?: string }>;
  reasons?: Record<string, string>;
  summary?: string;
}

export type OnEvent = (event: AnalysisEvent) => void;

// AI-based agent selection result
export interface AgentSelection {
  agent: AgentPersona;
  reason: string;
}

// Agent selection system prompt
function buildSelectionPrompt(maxAgents: number): string {
  const agentList = Object.values(AGENTS)
    .map(a => `- ${a.id}（${a.name}，${a.role}）：${a.description}`)
    .join('\n');

  return `你是「心靈日記」的 AI 好友調度員。根據使用者的訊息或日記內容，選出最適合的好友來回應。

好友列表：
${agentList}

請以 JSON 格式回傳（只能回傳 JSON，不能有其他文字）：
{
  "selected": [
    { "id": "agent_id", "reason": "選擇這位好友的具體原因（1-2句話）" }
  ],
  "summary": "用溫暖的語氣告訴使用者，你為什麼請了這些好友，以及他們能幫什麼"
}

規則：
- 最多選 ${maxAgents} 位，最少 1 位
- 根據訊息的主要主題、情境、需求來選擇
- reason 要說明訊息中哪些內容讓你選了這位好友
- summary 是給使用者看的，要自然、溫暖、繁體中文
- 如果訊息很一般或不明確，選最相關的 1-2 位即可`;
}

// Use Gemini AI to select the most appropriate agents
export async function selectAgentsWithAI(
  text: string,
  maxAgents: number = 3,
): Promise<{ selections: AgentSelection[]; summary: string }> {
  const systemPrompt = buildSelectionPrompt(maxAgents);

  try {
    const raw = await withGeminiRetry(async (apiKey) => {
      const genai = new GoogleGenerativeAI(apiKey);
      const model = genai.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        systemInstruction: systemPrompt,
        generationConfig: {
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
      });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('agent selection timeout')), 10000)
      );
      const res = await Promise.race([
        model.generateContent(text.slice(0, 2000)), // cap context length
        timeout,
      ]);
      return res.response.text();
    });

    const parsed = JSON.parse(raw);
    const selections: AgentSelection[] = [];

    for (const item of parsed.selected || []) {
      const agent = AGENTS[item.id];
      if (agent) {
        selections.push({ agent, reason: item.reason || '' });
      }
    }

    if (selections.length === 0) throw new Error('No valid agents returned');

    return {
      selections,
      summary: parsed.summary || `我請了${selections.map(s => s.agent.name).join('和')}來為你回應`,
    };
  } catch (err) {
    // Error fallback: pick xiaoyu (emotional support) as universal default
    const fallback = AGENTS['xiaoyu'];
    return {
      selections: [{ agent: fallback, reason: '作為你的心靈夥伴陪你聊聊' }],
      summary: `讓${fallback.name}來陪你聊聊吧`,
    };
  }
}

// Run a single agent analysis
async function runAgent(
  agent: AgentPersona,
  title: string,
  content: string,
  _apiKey: string, // ignored — withStreamRetry handles key
  onEvent: OnEvent,
  imageContext?: string
): Promise<{ agentId: string; result: string }> {
  onEvent({
    type: 'agent-start',
    agentId: agent.id,
    agentName: agent.name,
    agentEmoji: agent.emoji,
    agentRole: agent.role,
    message: `${agent.name} 正在分析...`,
  });

  let prompt = `日記標題：${title}\n\n日記內容：${content}`;
  if (imageContext) prompt += `\n\n[附件圖片描述]：${imageContext}`;

  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  let fullText = '';

  const { withStreamRetry } = await import('./geminiRetry.js');
  await withStreamRetry(async (apiKey) => {
    const genai = new GoogleGenerativeAI(apiKey);
    const geminiModel = genai.getGenerativeModel({
      model: modelName,
      systemInstruction: agent.systemPrompt,
      generationConfig: { maxOutputTokens: 2048 },
    });

    const result = await geminiModel.generateContentStream(prompt);
    fullText = '';

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        fullText += text;
        onEvent({
          type: 'agent-thinking',
          agentId: agent.id,
          agentName: agent.name,
          agentEmoji: agent.emoji,
          content: text,
        });
      }
    }

    const response = await result.response;
    const usage = response.usageMetadata;
    if (usage) {
      trackUsageByKey(apiKey, modelName, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 'diary-agent');
    }
  }, { maxRetries: 3 });

  onEvent({
    type: 'agent-done',
    agentId: agent.id,
    agentName: agent.name,
    agentEmoji: agent.emoji,
    content: fullText,
  });

  return { agentId: agent.id, result: fullText };
}

// Master synthesis
async function synthesize(
  agentResults: Array<{ agentId: string; result: string }>,
  title: string,
  content: string,
  onEvent: OnEvent
): Promise<string> {
  onEvent({ type: 'synthesizing', message: '🧠 整合者正在彙整所有觀點...' });

  const analysisBlock = agentResults.map(r => {
    const agent = AGENTS[r.agentId];
    return `【${agent.emoji} ${agent.name}（${agent.role}）的分析】\n${r.result}`;
  }).join('\n\n');

  const result = await withGeminiRetry(async (apiKey) => {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      systemInstruction: MASTER_AGENT_PROMPT,
      generationConfig: { maxOutputTokens: 8192 },
    });

    const prompt = `日記標題：${title}\n\n日記內容：${content}\n\n以下是各位好友的分析：\n\n${analysisBlock}`;

    let fullText = '';
    const streamResult = await model.generateContentStream(prompt);
    for await (const chunk of streamResult.stream) {
      const text = chunk.text();
      if (text) {
        fullText += text;
        onEvent({ type: 'synthesizing', content: text });
      }
    }

    const response = await streamResult.response;
    const usage = response.usageMetadata;
    if (usage) {
      trackUsageByKey(apiKey, process.env.GEMINI_MODEL || 'gemini-2.5-flash', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 'diary-master');
    }

    return fullText;
  });

  return result;
}

// Generate auto-tags
async function generateTags(title: string, content: string): Promise<string[]> {
  const result = await withGeminiRetry(async (apiKey) => {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      systemInstruction: '你是標籤生成助手。根據日記標題和內容，生成 2-5 個簡短的繁體中文標籤。每個標籤 1-4 個字。只回傳標籤，用逗號分隔。不加井號。',
      generationConfig: { maxOutputTokens: 100 },
    });
    const res = await model.generateContent(`標題：${title}\n內容：${content}`);
    return res.response.text();
  });

  return result.split(/[,，、]/).map(t => t.trim()).filter(t => t.length > 0 && t.length <= 10).slice(0, 5);
}

// Main entry: analyze diary with multi-agent pipeline
export async function analyzeDiary(
  title: string,
  content: string,
  onEvent: OnEvent,
  imageContext?: string
): Promise<{ reflection: string; tags: string[]; agentResults: Array<{ agentId: string; name: string; emoji: string; role: string; result: string }> }> {
  // Phase 1: AI-based agent selection
  onEvent({ type: 'phase', phase: 'analyzing', message: 'AI 分析日記內容，選擇最適合的好友...' });
  const { selections, summary: selectionSummary } = await selectAgentsWithAI(`日記標題：${title}\n\n日記內容：${content.slice(0, 1000)}`, 4);
  const selectedAgents = selections.map(s => s.agent);

  // Emit intent event with agent reasons (like chat)
  const reasonsMap: Record<string, string> = {};
  for (const s of selections) reasonsMap[s.agent.id] = s.reason;
  onEvent({
    type: 'intent',
    agents: selections.map(s => ({ id: s.agent.id, name: s.agent.name, emoji: s.agent.emoji, role: s.agent.role, reason: s.reason })),
    reasons: reasonsMap,
    summary: selectionSummary,
  });

  onEvent({
    type: 'phase',
    phase: 'thinking',
    message: `派出 ${selectedAgents.length} 位好友分析`,
    agents: selectedAgents.map(a => ({ id: a.id, name: a.name, emoji: a.emoji, role: a.role })),
  });

  // Phase 2: Run agents in parallel with batch keys
  const keys = assignBatchKeys(selectedAgents.length);
  const agentPromises = selectedAgents.map((agent, i) => {
    const key = keys[i % keys.length];
    return runAgent(agent, title, content, key, onEvent, imageContext).catch(err => {
      onEvent({ type: 'error', agentId: agent.id, message: `${agent.name} 分析失敗: ${err.message}` });
      return { agentId: agent.id, result: '（分析暫時無法完成）' };
    });
  });

  const agentResults = await Promise.all(agentPromises);

  // Phase 3: Synthesize
  onEvent({ type: 'phase', phase: 'synthesizing', message: '整合分析結果...' });
  const reflection = await synthesize(agentResults, title, content, onEvent);

  // Phase 4: Auto-tags (parallel with synthesis done)
  onEvent({ type: 'phase', phase: 'tagging', message: '生成標籤...' });
  let tags: string[] = [];
  try {
    tags = await generateTags(title, content);
    onEvent({ type: 'tags', tags });
  } catch {
    tags = [];
  }

  // Done
  onEvent({ type: 'done', reflection, tags });

  return {
    reflection,
    tags,
    agentResults: agentResults.map(r => {
      const agent = AGENTS[r.agentId];
      return { agentId: r.agentId, name: agent.name, emoji: agent.emoji, role: agent.role, result: r.result };
    }),
  };
}
