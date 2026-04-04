import { withGeminiRetry } from './geminiRetry.js';
import { trackUsageByKey } from './keyPool.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface IntentAgent {
  id: string;
  reason: string;
}

export interface IntentResult {
  agents: IntentAgent[];
  summary: string;
}

export async function analyzeIntent(
  message: string,
  history: string,
  availableAgents: Array<{ id: string; name: string; emoji: string; role: string; description: string }>
): Promise<IntentResult> {
  const agentList = availableAgents
    .map(a => `- id: "${a.id}", name: "${a.name}", emoji: "${a.emoji}", role: "${a.role}", description: "${a.description}"`)
    .join('\n');

  const systemPrompt = `你是一個意圖分析器。根據使用者的訊息和對話歷史，從可用的 AI 好友中選出 2-3 位最相關的來回應。

可用的 AI 好友：
${agentList}

規則：
- 選出 2-3 位最相關的好友（不多於 3 位）
- 為每位被選中的好友提供一句簡短理由（繁體中文）
- 提供一句總結，例如「根據你的訊息，我請了小語和阿哲來聊聊」
- 全部使用繁體中文
- 如果沒有明確匹配，預設選擇 xiaoyu 和 azhe

回傳 JSON 格式：
{
  "agents": [
    { "id": "agent_id", "reason": "選擇理由" }
  ],
  "summary": "總結句"
}`;

  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const result = await withGeminiRetry(async (apiKey) => {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
      },
    });

    let prompt = `使用者訊息：${message}`;
    if (history) {
      prompt += `\n\n最近對話紀錄：\n${history}`;
    }

    const response = await model.generateContent(prompt);
    const text = response.response.text();

    const usage = response.response.usageMetadata;
    if (usage) {
      trackUsageByKey(apiKey, modelName, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 'chat-intent');
    }

    return text;
  });

  try {
    const parsed = JSON.parse(result) as IntentResult;

    // Validate and ensure we have at least 2 agents
    if (!parsed.agents || parsed.agents.length === 0) {
      return getDefaultIntent(availableAgents);
    }

    // Cap at 3 agents
    parsed.agents = parsed.agents.slice(0, 3);

    // Validate agent IDs exist
    const validIds = new Set(availableAgents.map(a => a.id));
    parsed.agents = parsed.agents.filter(a => validIds.has(a.id));

    if (parsed.agents.length === 0) {
      return getDefaultIntent(availableAgents);
    }

    if (!parsed.summary) {
      const names = parsed.agents.map(a => {
        const agent = availableAgents.find(av => av.id === a.id);
        return agent?.name || a.id;
      }).join('和');
      parsed.summary = `根據你的訊息，我請了${names}來聊聊`;
    }

    return parsed;
  } catch {
    console.warn('[intentAnalyzer] Failed to parse Gemini response, using defaults');
    return getDefaultIntent(availableAgents);
  }
}

function getDefaultIntent(
  availableAgents: Array<{ id: string; name: string; emoji: string; role: string; description: string }>
): IntentResult {
  const xiaoyu = availableAgents.find(a => a.id === 'xiaoyu');
  const azhe = availableAgents.find(a => a.id === 'azhe');

  const agents: IntentAgent[] = [];
  if (xiaoyu) agents.push({ id: 'xiaoyu', reason: '提供情緒支持和共感回應' });
  if (azhe) agents.push({ id: 'azhe', reason: '提供理性分析和建議' });

  return {
    agents,
    summary: '根據你的訊息，我請了小語和阿哲來聊聊',
  };
}
