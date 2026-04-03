import { AGENTS, MASTER_AGENT_PROMPT, AgentPersona } from './agents.js';
import { withGeminiRetry } from './geminiRetry.js';
import { assignBatchKeys, trackUsageByKey } from './keyPool.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface AnalysisEvent {
  type: 'phase' | 'agent-start' | 'agent-thinking' | 'agent-done' | 'synthesizing' | 'done' | 'error' | 'tags';
  phase?: string;
  message?: string;
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  agentRole?: string;
  content?: string;
  tags?: string[];
  reflection?: string;
  agents?: Array<{ id: string; name: string; emoji: string; role: string }>;
}

export type OnEvent = (event: AnalysisEvent) => void;

// Determine which agents should analyze this entry
function selectAgents(title: string, content: string): AgentPersona[] {
  const text = `${title} ${content}`.toLowerCase();
  const scored = Object.values(AGENTS).map(agent => {
    const score = agent.topics.reduce((sum, topic) => {
      return sum + (text.includes(topic) ? 1 : 0);
    }, 0);
    return { agent, score };
  });

  // Always include xiaoyu (emotional support)
  const selected = scored.filter(s => s.score > 0 || s.agent.id === 'xiaoyu');

  // If nothing matched, use xiaoyu + azhe as defaults
  if (selected.length <= 1) {
    const azhe = Object.values(AGENTS).find(a => a.id === 'azhe')!;
    if (!selected.find(s => s.agent.id === 'azhe')) {
      selected.push({ agent: azhe, score: 0 });
    }
  }

  // Max 4 agents to avoid token waste
  return selected
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(s => s.agent);
}

// Run a single agent analysis
async function runAgent(
  agent: AgentPersona,
  title: string,
  content: string,
  apiKey: string,
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

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20';
  const genai = new GoogleGenerativeAI(apiKey);
  const geminiModel = genai.getGenerativeModel({
    model,
    systemInstruction: agent.systemPrompt,
    generationConfig: { maxOutputTokens: 512 },
  });

  let prompt = `日記標題：${title}\n\n日記內容：${content}`;
  if (imageContext) {
    prompt += `\n\n[附件圖片描述]：${imageContext}`;
  }

  const result = await geminiModel.generateContentStream(prompt);
  let fullText = '';

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

  // Track usage
  const response = await result.response;
  const usage = response.usageMetadata;
  if (usage) {
    trackUsageByKey(apiKey, model, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 'diary-agent');
  }

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
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20',
      systemInstruction: MASTER_AGENT_PROMPT,
      generationConfig: { maxOutputTokens: 1024 },
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
      trackUsageByKey(apiKey, process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 'diary-master');
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
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20',
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
  // Phase 1: Select agents
  onEvent({ type: 'phase', phase: 'analyzing', message: '正在分析日記內容...' });
  const selectedAgents = selectAgents(title, content);

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
