/**
 * geminiRetry.ts — powered by @kevinsisi/ai-core withRetry
 *
 * Keeps the same public API as the old implementation so callers don't change.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { withRetry, NoAvailableKeyError } from "@kevinsisi/ai-core";
import {
  getAvailableKey,
  getAvailableKeyExcluding,
  markKeyBad,
  assignBatchKeys,
  trackUsageByKey,
} from "./pool.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxRetries?: number;
  callType?: string;
}

export interface CallGeminiTextOptions {
  maxRetries?: number;
  callType?: string;
  disableThinking?: boolean;
  timeoutMs?: number;
}

// ── Main retry wrapper ─────────────────────────────────────────────────

export async function withGeminiRetry<T>(
  fn: (apiKey: string) => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const initialKey = await getAvailableKey();
  if (!initialKey) {
    throw new Error("[geminiRetry] No API keys available");
  }

  return withRetry(fn, initialKey, {
    maxRetries: options?.maxRetries ?? 3,
    rotateKey: async () => {
      const nextKey = await getAvailableKeyExcluding(initialKey);
      if (!nextKey) throw new NoAvailableKeyError();
      return nextKey;
    },
    onRetry: async (info) => {
      if (
        info.errorClass === "quota" ||
        info.errorClass === "rate-limit" ||
        info.errorClass === "network"
      ) {
        await markKeyBad(initialKey, info.errorClass);
      }
      console.warn(
        `[geminiRetry] Attempt ${info.attempt}/${info.maxRetries + 1} failed: ${info.errorClass}`
      );
    },
  });
}

// ── Shared text call wrapper ───────────────────────────────────────────

export async function callGeminiText(
  systemPrompt: string,
  prompt: string,
  maxOutputTokens: number,
  options: CallGeminiTextOptions = {}
): Promise<string> {
  const {
    maxRetries = 3,
    callType = "gemini",
    disableThinking = false,
    timeoutMs = 15000,
  } = options;
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  return withGeminiRetry(async (apiKey) => {
    const genai = new GoogleGenerativeAI(apiKey);
    const generationConfig: Record<string, unknown> = { maxOutputTokens };
    if (disableThinking) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    const model = genai.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      generationConfig,
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), timeoutMs)
    );
    const response = await Promise.race([model.generateContent(prompt), timeout]);
    const text = response.response.text();

    const usage = response.response.usageMetadata;
    if (usage) {
      trackUsageByKey(
        apiKey,
        modelName,
        usage.promptTokenCount || 0,
        usage.candidatesTokenCount || 0,
        callType
      );
    }
    return text;
  }, { maxRetries });
}

// ── Stream retry ───────────────────────────────────────────────────────

export async function withStreamRetry(
  fn: (apiKey: string) => Promise<void>,
  options?: RetryOptions
): Promise<void> {
  return withGeminiRetry(fn, options);
}

// ── Batch caller ───────────────────────────────────────────────────────

export function createBatchCaller(count: number) {
  let keys: string[] = [];
  let index = 0;
  let initialized = false;

  const ensureKeys = async () => {
    if (!initialized) {
      keys = await assignBatchKeys(count);
      initialized = true;
    }
  };

  return {
    async getKey(): Promise<string> {
      await ensureKeys();
      if (index >= keys.length) {
        throw new Error("[batchCaller] No more keys in batch");
      }
      return keys[index++];
    },

    async callWithRetry<T>(
      fn: (apiKey: string) => Promise<T>,
      options?: RetryOptions
    ): Promise<T> {
      return withGeminiRetry(fn, options);
    },
  };
}
