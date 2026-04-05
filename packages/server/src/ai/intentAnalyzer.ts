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

// Timeout wrapper — resolve with null if the promise takes too long
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function analyzeIntent(
  message: string,
  history: string,
  availableAgents: Array<{ id: string; name: string; emoji: string; role: string; description: string }>
): Promise<IntentResult> {
  const agentList = availableAgents
    .map(a => `- id: "${a.id}", name: "${a.name}", emoji: "${a.emoji}", role: "${a.role}", description: "${a.description}"`)
    .join('\n');

  const systemPrompt = `你是一個意圖分析器。根據使用者的訊息和對話歷史，從可用的 AI 夥伴中邀請 2-3 位最相關的來回應。

可用的 AI 夥伴：
${agentList}

規則：
- 邀請 2-3 位最相關的夥伴（不多於 3 位）
- 為每位被邀請的夥伴提供一句簡短理由（繁體中文）
- 提供一句總結，例如「根據你的訊息，我邀請了樂樂和阿思來聊聊」
- 全部使用繁體中文
- 如果沒有明確匹配，預設邀請 lele 和 asi

回傳 JSON 格式：
{
  "agents": [
    { "id": "agent_id", "reason": "選擇理由" }
  ],
  "summary": "總結句"
}`;

  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  try {
    const result = await withTimeout(
      withGeminiRetry(async (apiKey) => {
        const genai = new GoogleGenerativeAI(apiKey);
        const model = genai.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt,
          generationConfig: {
            maxOutputTokens: 256,
            responseMimeType: 'application/json',
            // @ts-ignore — limit thinking budget for 2.5 models
            thinkingConfig: { thinkingBudget: 0 },
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
      }),
      10000 // 10 second timeout
    );

    if (result === null) {
      console.warn('[intentAnalyzer] Timed out after 10s, using defaults');
      return getDefaultIntent(availableAgents);
    }

    const parsed = JSON.parse(result) as IntentResult;

    if (!parsed.agents || parsed.agents.length === 0) {
      return getDefaultIntent(availableAgents);
    }

    parsed.agents = parsed.agents.slice(0, 3);

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
      parsed.summary = `根據你的訊息，我邀請了${names}來聊聊`;
    }

    return parsed;
  } catch (err) {
    console.warn('[intentAnalyzer] Failed:', err);
    return getDefaultIntent(availableAgents);
  }
}

function getDefaultIntent(
  availableAgents: Array<{ id: string; name: string; emoji: string; role: string; description: string }>
): IntentResult {
  const lele = availableAgents.find(a => a.id === 'lele');
  const asi = availableAgents.find(a => a.id === 'asi');

  const agents: IntentAgent[] = [];
  if (lele) agents.push({ id: 'lele', reason: '帶著正向能量，從鼓勵的角度陪你聊聊' });
  if (asi) agents.push({ id: 'asi', reason: '幫你看見更深層的感受和需求' });

  return {
    agents,
    summary: '根據你的訊息，我邀請了樂樂和阿思來聊聊',
  };
}
