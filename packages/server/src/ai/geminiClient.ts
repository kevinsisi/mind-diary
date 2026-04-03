import { GoogleGenerativeAI } from "@google/generative-ai";
import { withGeminiRetry } from "./geminiRetry.js";
import { trackUsageByKey } from "./keyPool.js";

// ── Config ────────────────────────────────────────────────────────────
const DEFAULT_MODEL = "gemini-2.5-flash";

function getModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

// ── Internal helpers ──────────────────────────────────────────────────

function createClient(apiKey: string) {
  return new GoogleGenerativeAI(apiKey);
}

function extractUsage(response: any) {
  const meta = response?.usageMetadata;
  return {
    promptTokens: meta?.promptTokenCount ?? 0,
    completionTokens: meta?.candidatesTokenCount ?? 0,
    totalTokens: meta?.totalTokenCount ?? 0,
  };
}

function track(
  apiKey: string,
  usage: ReturnType<typeof extractUsage>,
  callType: string
) {
  trackUsageByKey(
    apiKey,
    getModel(),
    usage.promptTokens,
    usage.completionTokens,
    callType
  );
}

// ── Exported functions ────────────────────────────────────────────────

/**
 * Generate text from a simple prompt.
 */
export async function generateText(
  prompt: string,
  options?: {
    systemPrompt?: string;
    maxTokens?: number;
  }
): Promise<{ text: string; usage: any }> {
  return withGeminiRetry(async (apiKey) => {
    const client = createClient(apiKey);
    const model = client.getGenerativeModel({
      model: getModel(),
      ...(options?.systemPrompt && {
        systemInstruction: options.systemPrompt,
      }),
      generationConfig: {
        ...(options?.maxTokens && { maxOutputTokens: options.maxTokens }),
      },
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    const usage = extractUsage(response);

    track(apiKey, usage, "generateText");

    return { text, usage };
  });
}

/**
 * Generate text with RAG context and conversation history.
 * System prompt and responses in Traditional Chinese.
 */
export async function generateTextWithContext(
  query: string,
  context: string[],
  history?: Array<{ role: string; content: string }>
): Promise<{ text: string; usage: any }> {
  const systemPrompt = `你是一個個人知識庫助手，名為「心智日記」。你的任務是根據使用者提供的資料和對話紀錄，以繁體中文回答問題。

你的特點：
- 以親切、有條理的方式回答問題
- 優先使用提供的上下文資料來回答
- 如果上下文資料不足以回答，請誠實說明並提供你所知道的相關資訊
- 回答時引用相關的資料來源
- 保持回答簡潔但完整`;

  const contextBlock =
    context.length > 0
      ? `\n\n以下是相關的參考資料：\n${context.map((c, i) => `--- 資料 ${i + 1} ---\n${c}`).join("\n\n")}`
      : "";

  return withGeminiRetry(async (apiKey) => {
    const client = createClient(apiKey);
    const model = client.getGenerativeModel({
      model: getModel(),
      systemInstruction: systemPrompt,
    });

    // Build chat history for Gemini (maps 'assistant' -> 'model')
    const chatHistory = (history || []).map((msg) => ({
      role: msg.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history: chatHistory });
    const fullPrompt = `${query}${contextBlock}`;
    const result = await chat.sendMessage(fullPrompt);
    const response = result.response;
    const text = response.text();
    const usage = extractUsage(response);

    track(apiKey, usage, "generateTextWithContext");

    return { text, usage };
  });
}

/**
 * Analyze an image with an optional prompt.
 */
export async function analyzeImage(
  imageBuffer: Buffer,
  mimeType: string,
  prompt?: string
): Promise<{ text: string; usage: any }> {
  const imagePrompt = prompt || "請描述這張圖片的內容。";

  return withGeminiRetry(async (apiKey) => {
    const client = createClient(apiKey);
    const model = client.getGenerativeModel({ model: getModel() });

    const imagePart = {
      inlineData: {
        data: imageBuffer.toString("base64"),
        mimeType,
      },
    };

    const result = await model.generateContent([imagePrompt, imagePart]);
    const response = result.response;
    const text = response.text();
    const usage = extractUsage(response);

    track(apiKey, usage, "analyzeImage");

    return { text, usage };
  });
}

/**
 * Generate a summary of the given text.
 */
export async function generateSummary(text: string): Promise<string> {
  const result = await generateText(text, {
    systemPrompt:
      "你是一個摘要助手。請將使用者提供的文字整理成簡潔的繁體中文摘要，保留重要資訊。",
    maxTokens: 1024,
  });
  return result.text;
}

/**
 * Generate a diary reflection based on entry content and optional mood.
 */
export async function generateDiaryReflection(
  content: string,
  mood?: string
): Promise<string> {
  const moodHint = mood ? `\n使用者今天的心情標記為：${mood}` : "";

  const result = await generateText(content, {
    systemPrompt: `你是一個溫暖且富有同理心的日記反思助手。根據使用者的日記內容，提供一段簡短的繁體中文反思或回饋。

你的風格：
- 溫暖且支持性的語氣
- 幫助使用者從不同角度看待事情
- 適當時給予鼓勵
- 保持簡短（2-4句話）${moodHint}`,
    maxTokens: 512,
  });
  return result.text;
}

/**
 * Auto-generate tags for diary content using AI.
 * Returns an array of 2-5 short tag names in Traditional Chinese.
 */
export async function generateAutoTags(content: string, title: string): Promise<string[]> {
  const result = await generateText(`標題：${title}\n\n內容：${content}`, {
    systemPrompt: `你是一個標籤生成助手。根據日記的標題和內容，生成 2-5 個簡短的繁體中文標籤。

規則：
- 每個標籤 1-4 個字（例如：工作、旅行、心情、學習、健康）
- 只回傳標籤，用逗號分隔
- 不要加井號或其他符號
- 涵蓋主題、情緒、活動等不同面向`,
    maxTokens: 100,
  });

  return result.text
    .split(/[,，、]/)
    .map(t => t.trim())
    .filter(t => t.length > 0 && t.length <= 10)
    .slice(0, 5);
}

// ── Backward-compatible aliases ───────────────────────────────────────

/** @deprecated Use generateDiaryReflection instead */
export async function generateReflection(content: string): Promise<string> {
  return generateDiaryReflection(content);
}

/** @deprecated Use generateTextWithContext instead */
export async function chatWithContext(
  message: string,
  context: string,
  history: Array<{ role: string; content: string }>
): Promise<string> {
  const result = await generateTextWithContext(
    message,
    context ? [context] : [],
    history
  );
  return result.text;
}
