import { sqlite } from "../db/connection.js";
import { callGeminiText } from "../ai/geminiRetry.js";

const MEMORY_KINDS = ["preference", "goal", "background", "relationship", "ongoing"] as const;

type MemoryKind = (typeof MEMORY_KINDS)[number];

interface UserMemoryRow {
  id: number;
  user_id: number;
  kind: MemoryKind;
  summary: string;
  source_session_id: number | null;
  source_message_id: number | null;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export type { UserMemoryRow, MemoryKind };

interface CandidateMemory {
  kind: string;
  summary: string;
  confidence?: number;
}

interface ExtractAndStoreMemoryInput {
  userId: number;
  sessionId: number;
  sourceMessageId: number | null;
  userMessage: string;
  assistantMessage: string;
  historyStr: string;
  existingMemoryStr: string;
}

function normalizeSummary(summary: string): string {
  return summary.replace(/\s+/g, " ").trim();
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseCandidateMemories(rawText: string): CandidateMemory[] {
  const text = stripCodeFence(rawText);
  const jsonStart = text.indexOf("[");
  const jsonEnd = text.lastIndexOf("]");
  const jsonText = jsonStart >= 0 && jsonEnd >= jsonStart ? text.slice(jsonStart, jsonEnd + 1) : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter((item): item is CandidateMemory => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as CandidateMemory;
    return typeof candidate.kind === "string" && typeof candidate.summary === "string";
  });
}

function sanitizeCandidateMemories(candidates: CandidateMemory[]): Array<{ kind: MemoryKind; summary: string; confidence: number }> {
  const seen = new Set<string>();

  return candidates
    .map((candidate) => {
      const loweredKind = candidate.kind.trim().toLowerCase();
      if (!MEMORY_KINDS.includes(loweredKind as MemoryKind)) return null;

      const summary = normalizeSummary(candidate.summary).slice(0, 160);
      if (!summary || summary.length < 6) return null;

      const confidence = Math.max(0, Math.min(100, Math.round(candidate.confidence ?? 70)));
      const dedupeKey = `${loweredKind}::${summary}`;
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);

      return {
        kind: loweredKind as MemoryKind,
        summary,
        confidence,
      };
    })
    .filter((item): item is { kind: MemoryKind; summary: string; confidence: number } => Boolean(item))
    .slice(0, 5);
}

export function getUserMemories(userId: number, limit = 8): UserMemoryRow[] {
  if (!userId) return [];

  return sqlite
    .prepare(
      `SELECT id, user_id, kind, summary, source_session_id, source_message_id, confidence, created_at, updated_at
       FROM user_memories
       WHERE user_id = ?
       ORDER BY confidence DESC, updated_at DESC
       LIMIT ?`
    )
    .all(userId, limit) as UserMemoryRow[];
}

export function deleteUserMemory(userId: number, memoryId: number): boolean {
  if (!userId || !Number.isInteger(memoryId) || memoryId <= 0) return false;

  const result = sqlite
    .prepare("DELETE FROM user_memories WHERE id = ? AND user_id = ?")
    .run(memoryId, userId);

  return result.changes > 0;
}

export function formatUserMemories(userId: number, limit = 8): string {
  const memories = getUserMemories(userId, limit);
  if (memories.length === 0) return "";

  return memories
    .map((memory, index) => `${index + 1}. [${memory.kind}] ${memory.summary}`)
    .join("\n");
}

async function extractCandidateMemories(input: ExtractAndStoreMemoryInput): Promise<Array<{ kind: MemoryKind; summary: string; confidence: number }>> {
  const prompt = [
    `最新使用者訊息：${input.userMessage}`,
    `最新 AI 回覆：${input.assistantMessage}`,
    input.historyStr ? `本次對話近期紀錄：\n${input.historyStr}` : "",
    input.existingMemoryStr ? `目前已知的跨對話記憶：\n${input.existingMemoryStr}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = `你是心靈日記的使用者記憶整理器。請從對話中提取「未來對話仍有幫助的長期記憶」，不要提取一次性瑣事。

只保留以下 kinds：preference、goal、background、relationship、ongoing。

規則：
- 只提取對未來對話有幫助的穩定資訊
- 不要重複已有記憶，只提新的或更精準的版本
- 不要捏造，不確定就不要寫
- summary 用繁體中文，1 句即可
- 請只回傳 JSON array，不要加說明文字

格式：
[{"kind":"preference","summary":"使用者偏好簡短且直接的回覆","confidence":82}]`;

  const raw = await callGeminiText(systemPrompt, prompt, 800, {
    maxRetries: 3,
    callType: "user-memory-extract",
    disableThinking: true,
    timeoutMs: 20000,
  });

  return sanitizeCandidateMemories(parseCandidateMemories(raw));
}

function storeUserMemories(input: ExtractAndStoreMemoryInput, memories: Array<{ kind: MemoryKind; summary: string; confidence: number }>): void {
  if (input.userId === 0 || memories.length === 0) return;

  const upsert = sqlite.prepare(`
    INSERT INTO user_memories (user_id, kind, summary, source_session_id, source_message_id, confidence)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, kind, summary)
    DO UPDATE SET
      source_session_id = excluded.source_session_id,
      source_message_id = excluded.source_message_id,
      confidence = MAX(user_memories.confidence, excluded.confidence),
      updated_at = datetime('now')
  `);

  const tx = sqlite.transaction(() => {
    for (const memory of memories) {
      upsert.run(
        input.userId,
        memory.kind,
        memory.summary,
        input.sessionId,
        input.sourceMessageId,
        memory.confidence,
      );
    }
  });

  tx();
}

export async function extractAndStoreUserMemories(input: ExtractAndStoreMemoryInput): Promise<void> {
  if (!input.userId) return;

  const memories = await extractCandidateMemories(input);
  storeUserMemories(input, memories);
}
