/**
 * Mind-diary key pool — backed by @kevinsisi/ai-core KeyPool.
 *
 * Exports:
 *   - pool (singleton KeyPool)
 *   - Convenience wrappers: getAvailableKey, getAvailableKeyExcluding,
 *     markKeyBad, assignBatchKeys (mirrors old keyPool.ts API)
 *   - Admin helpers: getKeyList, addApiKey, removeApiKey,
 *     invalidateKeyCache, trackUsage, trackUsageByKey, getUsageStats
 */

import {
  KeyPool,
  NoAvailableKeyError,
} from "@kevinsisi/ai-core";
import { MindDiaryAdapter } from "./mindDiaryAdapter.js";
import { sqlite } from "../db/connection.js";

// ── Singleton pool ─────────────────────────────────────────────────────

const adapter = new MindDiaryAdapter();
export const pool = new KeyPool(adapter, {
  defaultCooldownMs: 2 * 60_000,   // 2 min — rate limit (matches old COOLDOWN_429)
  authCooldownMs: 30 * 60_000,      // 30 min — auth failure
});

// ── Env key sync (run once at startup) ────────────────────────────────

function isValidKey(key: string): boolean {
  return (
    key.startsWith("AIza") &&
    key.length >= 20 &&
    !key.includes("YOUR_") &&
    !key.includes("PLACEHOLDER") &&
    !key.includes("xxx")
  );
}

function keySuffix(key: string): string {
  return key.slice(-6);
}

function syncEnvKeys(): void {
  const envRaw = process.env.GEMINI_API_KEYS || "";
  const envKeys = envRaw
    .split(",")
    .map((k) => k.trim())
    .filter(isValidKey);

  const upsert = sqlite.prepare(`
    INSERT INTO api_keys (key, source, suffix, is_blocked)
    VALUES (?, 'env', ?, 0)
    ON CONFLICT(key) DO UPDATE SET source = 'env'
  `);

  const tx = sqlite.transaction(() => {
    for (const key of envKeys) {
      upsert.run(key, keySuffix(key));
    }
  });
  tx();
}

syncEnvKeys();

// ── Convenience wrappers (drop-in replacements for old keyPool.ts) ─────

export async function getAvailableKey(): Promise<string | null> {
  try {
    const [key] = await pool.allocate(1);
    return key;
  } catch (err) {
    if (err instanceof NoAvailableKeyError) return null;
    throw err;
  }
}

export async function getAvailableKeyExcluding(failedKey: string): Promise<string | null> {
  // Mark the failed key in cooldown first
  await pool.release(failedKey, true).catch(() => {});
  // Invalidate cache so the cooldown is reflected immediately
  pool.invalidate();
  return getAvailableKey();
}

export async function markKeyBad(key: string, reason: string): Promise<void> {
  if (/suspended/i.test(reason)) {
    await pool.block(key);
  } else {
    const isAuth = /401|403|auth/i.test(reason);
    await pool.release(key, true, isAuth);
  }
  pool.invalidate();
}

export async function assignBatchKeys(count: number): Promise<string[]> {
  try {
    return await pool.allocate(count);
  } catch (err) {
    if (err instanceof NoAvailableKeyError) return [];
    throw err;
  }
}

export function invalidateKeyCache(): void {
  pool.invalidate();
}

// ── Admin helpers (mind-diary specific, not in ai-core) ───────────────

export function getKeyList() {
  const keys = sqlite
    .prepare("SELECT id, key, source, suffix, is_blocked FROM api_keys")
    .all() as Array<{
      id: number;
      key: string;
      source: string;
      suffix: string;
      is_blocked: number;
    }>;

  const now = Date.now();
  const cooldowns = sqlite
    .prepare(
      "SELECT key_id, reason, cooldown_until FROM api_key_cooldowns WHERE cooldown_until > ?"
    )
    .all(now) as Array<{
      key_id: number;
      reason: string;
      cooldown_until: number;
    }>;
  const cdMap = new Map(cooldowns.map((c) => [c.key_id, c]));

  return keys.map((k) => {
    const cd = cdMap.get(k.id);
    const inCooldown = !!cd;

    const usage = sqlite
      .prepare(
        `SELECT
           COUNT(*) as total_calls,
           COALESCE(SUM(tokens_in), 0) as total_tokens_in,
           COALESCE(SUM(tokens_out), 0) as total_tokens_out
         FROM api_key_usage WHERE key_id = ?`
      )
      .get(k.id) as {
        total_calls: number;
        total_tokens_in: number;
        total_tokens_out: number;
      };

    return {
      id: k.id,
      suffix: k.suffix,
      source: k.source,
      isBlocked: !!k.is_blocked,
      inCooldown,
      cooldownReason: cd?.reason ?? null,
      cooldownUntil: cd?.cooldown_until ?? null,
      cooldownRemaining: cd ? Math.max(0, cd.cooldown_until - now) : 0,
      totalCalls: usage?.total_calls ?? 0,
      totalTokensIn: usage?.total_tokens_in ?? 0,
      totalTokensOut: usage?.total_tokens_out ?? 0,
    };
  });
}

export function addApiKey(key: string): void {
  if (!isValidKey(key)) {
    throw new Error(
      "Invalid API key: must start with 'AIza' and be at least 20 characters"
    );
  }
  sqlite
    .prepare(
      "INSERT INTO api_keys (key, source, suffix, is_blocked) VALUES (?, 'db', ?, 0)"
    )
    .run(key, keySuffix(key));
  pool.invalidate();
}

export function removeApiKey(suffix: string): boolean {
  const record = sqlite
    .prepare("SELECT id, key, source FROM api_keys WHERE suffix = ?")
    .get(suffix) as { id: number; key: string; source: string } | undefined;

  if (!record) return false;

  if (record.source === "env") {
    sqlite
      .prepare("UPDATE api_keys SET is_blocked = 1 WHERE id = ?")
      .run(record.id);
  } else {
    sqlite
      .prepare("DELETE FROM api_key_cooldowns WHERE key_id = ?")
      .run(record.id);
    sqlite
      .prepare("DELETE FROM api_key_usage WHERE key_id = ?")
      .run(record.id);
    sqlite.prepare("DELETE FROM api_keys WHERE id = ?").run(record.id);
  }

  pool.invalidate();
  return true;
}

export function trackUsage(
  keyId: number,
  model: string,
  tokensIn: number,
  tokensOut: number,
  callType?: string
): void {
  sqlite
    .prepare(
      `INSERT INTO api_key_usage (key_id, model, tokens_in, tokens_out, call_type)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(keyId, model, tokensIn, tokensOut, callType ?? null);
}

export function trackUsageByKey(
  key: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  callType?: string
): void {
  const record = sqlite
    .prepare("SELECT id FROM api_keys WHERE key = ?")
    .get(key) as { id: number } | undefined;
  if (record) {
    trackUsage(record.id, model, tokensIn, tokensOut, callType);
  }
}

export function getUsageStats() {
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const query = (since: string) =>
    sqlite
      .prepare(
        `SELECT
           COUNT(*) as calls,
           COALESCE(SUM(tokens_in), 0) as tokens_in,
           COALESCE(SUM(tokens_out), 0) as tokens_out
         FROM api_key_usage
         WHERE created_at >= ?`
      )
      .get(since) as { calls: number; tokens_in: number; tokens_out: number };

  return {
    today: query(todayStart),
    last7d: query(sevenDaysAgo),
    last30d: query(thirtyDaysAgo),
  };
}
