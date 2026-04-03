import {
  getAvailableKey,
  getAvailableKeyExcluding,
  markKeyBad,
  assignBatchKeys,
  trackUsageByKey,
} from "./keyPool.js";

// ── Types ─────────────────────────────────────────────────────────────
export interface RetryOptions {
  maxRetries?: number;
  callType?: string;
}

// ── Error classification ──────────────────────────────────────────────

interface ClassifiedError {
  type: "rate_limit" | "auth" | "server" | "unknown";
  message: string;
}

function classifyError(err: unknown): ClassifiedError {
  const msg =
    err instanceof Error ? err.message : String(err);
  const combined = msg.toLowerCase();

  // Also check for status codes in error objects
  const status = (err as any)?.status ?? (err as any)?.httpStatusCode ?? 0;

  if (
    status === 429 ||
    combined.includes("429") ||
    combined.includes("resource_exhausted") ||
    combined.includes("rate")
  ) {
    return { type: "rate_limit", message: msg };
  }

  if (
    status === 401 ||
    status === 403 ||
    combined.includes("401") ||
    combined.includes("403") ||
    combined.includes("api_key_invalid") ||
    combined.includes("permission")
  ) {
    return { type: "auth", message: msg };
  }

  if (
    status >= 500 ||
    combined.includes("500") ||
    combined.includes("503") ||
    combined.includes("internal") ||
    combined.includes("unavailable")
  ) {
    return { type: "server", message: msg };
  }

  return { type: "unknown", message: msg };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main retry wrapper ────────────────────────────────────────────────

export async function withGeminiRetry<T>(
  fn: (apiKey: string) => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  let currentKey = getAvailableKey();

  if (!currentKey) {
    throw new Error("[geminiRetry] No API keys available");
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn(currentKey);
      return result;
    } catch (err) {
      lastError = err;
      const classified = classifyError(err);

      console.warn(
        `[geminiRetry] Attempt ${attempt + 1}/${maxRetries + 1} failed: ${classified.type} — ${classified.message}`
      );

      if (attempt >= maxRetries) break;

      switch (classified.type) {
        case "rate_limit": {
          markKeyBad(currentKey, "429 rate_limit");
          const nextKey = getAvailableKeyExcluding(currentKey);
          if (!nextKey) {
            throw new Error(
              "[geminiRetry] All keys exhausted after rate limit"
            );
          }
          currentKey = nextKey;
          break;
        }

        case "auth": {
          markKeyBad(currentKey, "401/403 auth_failure");
          const nextKey = getAvailableKeyExcluding(currentKey);
          if (!nextKey) {
            throw new Error(
              "[geminiRetry] All keys exhausted after auth failure"
            );
          }
          currentKey = nextKey;
          break;
        }

        case "server": {
          markKeyBad(currentKey, "5xx server_error");
          await sleep(1000);
          // Retry same key after short wait (it got a short cooldown)
          // but if it's still in cooldown, get another
          const retryKey = getAvailableKey();
          if (!retryKey) {
            throw new Error(
              "[geminiRetry] All keys exhausted after server error"
            );
          }
          currentKey = retryKey;
          break;
        }

        case "unknown":
          // Don't retry unknown errors
          throw err;
      }
    }
  }

  throw lastError;
}

// ── Stream retry (same logic, void return) ────────────────────────────

export async function withStreamRetry(
  fn: (apiKey: string) => Promise<void>,
  options?: RetryOptions
): Promise<void> {
  return withGeminiRetry(fn, options);
}

// ── Batch caller ──────────────────────────────────────────────────────

export function createBatchCaller(count: number) {
  const keys = assignBatchKeys(count);
  let index = 0;

  return {
    getKey(): string {
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
