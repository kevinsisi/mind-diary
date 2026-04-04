import { sqlite } from "../db/connection.js";

// ── Types ─────────────────────────────────────────────────────────────
interface KeyRecord {
  id: number;
  key: string;
  source: string;
  suffix: string;
  is_blocked: number;
}

interface CooldownRecord {
  id: number;
  key_id: number;
  reason: string;
  cooldown_until: number;
}

interface CooldownEntry {
  keyId: number;
  reason: string;
  until: number;
}

// ── Cooldown durations (ms) ───────────────────────────────────────────
const COOLDOWN_429 = 2 * 60 * 1000; // 2 min — rate limit
const COOLDOWN_AUTH = 30 * 60 * 1000; // 30 min — auth failure
const COOLDOWN_5XX = 30 * 1000; // 30 sec — server error

// ── In-memory caches ──────────────────────────────────────────────────
let keyCache: KeyRecord[] | null = null;
let cooldownCache: Map<number, CooldownEntry> = new Map();
let cooldownsLoaded = false;

// ── Helpers ───────────────────────────────────────────────────────────

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

/** Fisher-Yates in-place shuffle */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── DB-backed key storage ─────────────────────────────────────────────

function loadKeysFromDb(): KeyRecord[] {
  return sqlite
    .prepare("SELECT id, key, source, suffix, is_blocked FROM api_keys")
    .all() as KeyRecord[];
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

function ensureKeyCache(): KeyRecord[] {
  if (!keyCache) {
    syncEnvKeys();
    keyCache = loadKeysFromDb();
  }
  return keyCache;
}

// ── Cooldown management ───────────────────────────────────────────────

function loadCooldownsFromDb(): void {
  const rows = sqlite
    .prepare(
      "SELECT id, key_id, reason, cooldown_until FROM api_key_cooldowns"
    )
    .all() as CooldownRecord[];

  cooldownCache.clear();
  const now = Date.now();
  for (const r of rows) {
    if (r.cooldown_until > now) {
      cooldownCache.set(r.key_id, {
        keyId: r.key_id,
        reason: r.reason,
        until: r.cooldown_until,
      });
    }
  }
  cooldownsLoaded = true;
}

function ensureCooldowns(): void {
  if (!cooldownsLoaded) loadCooldownsFromDb();
}

function cleanExpiredCooldowns(): void {
  const now = Date.now();
  for (const [keyId, entry] of cooldownCache) {
    if (entry.until <= now) {
      cooldownCache.delete(keyId);
      sqlite
        .prepare("DELETE FROM api_key_cooldowns WHERE key_id = ?")
        .run(keyId);
    }
  }
}

function isInCooldown(keyId: number): boolean {
  ensureCooldowns();
  const entry = cooldownCache.get(keyId);
  if (!entry) return false;
  if (entry.until <= Date.now()) {
    cooldownCache.delete(keyId);
    sqlite
      .prepare("DELETE FROM api_key_cooldowns WHERE key_id = ?")
      .run(keyId);
    return false;
  }
  return true;
}

function setCooldown(keyId: number, reason: string, durationMs: number): void {
  ensureCooldowns();
  const until = Date.now() + durationMs;
  cooldownCache.set(keyId, { keyId, reason, until });

  sqlite
    .prepare(
      "DELETE FROM api_key_cooldowns WHERE key_id = ?"
    )
    .run(keyId);
  sqlite
    .prepare(
      "INSERT INTO api_key_cooldowns (key_id, reason, cooldown_until) VALUES (?, ?, ?)"
    )
    .run(keyId, reason, until);
}

function clearOldestCooldown(): KeyRecord | null {
  ensureCooldowns();
  let oldest: CooldownEntry | null = null;
  for (const entry of cooldownCache.values()) {
    if (!oldest || entry.until < oldest.until) {
      oldest = entry;
    }
  }
  if (!oldest) return null;

  cooldownCache.delete(oldest.keyId);
  sqlite
    .prepare("DELETE FROM api_key_cooldowns WHERE key_id = ?")
    .run(oldest.keyId);

  const keys = ensureKeyCache();
  return keys.find((k) => k.id === oldest!.keyId) || null;
}

// ── Cooldown duration from reason ─────────────────────────────────────

function cooldownDuration(reason: string): number {
  if (/429|rate|resource_exhausted/i.test(reason)) return COOLDOWN_429;
  if (/401|403|api_key_invalid|auth/i.test(reason)) return COOLDOWN_AUTH;
  if (/5\d\d|server/i.test(reason)) return COOLDOWN_5XX;
  return COOLDOWN_429; // default
}

// ── Exported API ──────────────────────────────────────────────────────

export function getAvailableKey(): string | null {
  cleanExpiredCooldowns();
  const keys = ensureKeyCache();
  const available = keys.filter(
    (k) => !k.is_blocked && !isInCooldown(k.id)
  );

  if (available.length > 0) {
    const pick = available[Math.floor(Math.random() * available.length)];
    return pick.key;
  }

  // Graceful degradation: clear oldest cooldown
  const rescued = clearOldestCooldown();
  return rescued ? rescued.key : null;
}

export function getAvailableKeyExcluding(
  failedKey: string
): string | null {
  cleanExpiredCooldowns();
  const keys = ensureKeyCache();
  const available = keys.filter(
    (k) => !k.is_blocked && !isInCooldown(k.id) && k.key !== failedKey
  );

  if (available.length > 0) {
    const pick = available[Math.floor(Math.random() * available.length)];
    return pick.key;
  }

  // Graceful degradation
  const rescued = clearOldestCooldown();
  if (rescued && rescued.key !== failedKey) return rescued.key;
  return null;
}

export function markKeyBad(key: string, reason: string): void {
  const keys = ensureKeyCache();
  const record = keys.find((k) => k.key === key);
  if (!record) return;

  // Permanently block suspended keys
  if (/suspended/i.test(reason)) {
    sqlite.prepare("UPDATE api_keys SET is_blocked = 1 WHERE id = ?").run(record.id);
    record.is_blocked = 1;
    console.log(`[keyPool] Key ...${record.suffix} BLOCKED — ${reason}`);
    return;
  }

  const duration = cooldownDuration(reason);
  setCooldown(record.id, reason, duration);
  console.log(
    `[keyPool] Key ...${record.suffix} cooldown ${duration / 1000}s — ${reason}`
  );
}

export function assignBatchKeys(count: number): string[] {
  cleanExpiredCooldowns();
  const keys = ensureKeyCache();
  const available = keys.filter(
    (k) => !k.is_blocked && !isInCooldown(k.id)
  );

  const shuffled = shuffle([...available]);
  const result: string[] = [];

  for (let i = 0; i < count; i++) {
    if (shuffled.length > 0) {
      result.push(shuffled[i % shuffled.length].key);
    } else {
      // No keys available; try graceful degradation
      const rescued = clearOldestCooldown();
      if (rescued) result.push(rescued.key);
    }
  }
  return result;
}

export function invalidateKeyCache(): void {
  keyCache = null;
  cooldownsLoaded = false;
  cooldownCache.clear();
}

export function getKeyList() {
  const keys = ensureKeyCache();
  ensureCooldowns();
  const now = Date.now();

  return keys.map((k) => {
    const cd = cooldownCache.get(k.id);
    const inCooldown = cd && cd.until > now;

    // Get usage stats for this key
    const usage = sqlite
      .prepare(
        `SELECT
           COUNT(*) as total_calls,
           COALESCE(SUM(tokens_in), 0) as total_tokens_in,
           COALESCE(SUM(tokens_out), 0) as total_tokens_out
         FROM api_key_usage WHERE key_id = ?`
      )
      .get(k.id) as { total_calls: number; total_tokens_in: number; total_tokens_out: number } | undefined;

    return {
      id: k.id,
      suffix: k.suffix,
      source: k.source,
      isBlocked: !!k.is_blocked,
      inCooldown: !!inCooldown,
      cooldownReason: inCooldown ? cd!.reason : null,
      cooldownUntil: inCooldown ? cd!.until : null,
      cooldownRemaining: inCooldown ? Math.max(0, cd!.until - now) : 0,
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

  invalidateKeyCache();
}

export function removeApiKey(suffix: string): boolean {
  const keys = ensureKeyCache();
  const record = keys.find((k) => k.suffix === suffix);
  if (!record) return false;

  if (record.source === "env") {
    // Can't remove ENV keys from DB; block instead
    sqlite
      .prepare("UPDATE api_keys SET is_blocked = 1 WHERE id = ?")
      .run(record.id);
  } else {
    // Delete cooldowns first, then the key
    sqlite
      .prepare("DELETE FROM api_key_cooldowns WHERE key_id = ?")
      .run(record.id);
    sqlite
      .prepare("DELETE FROM api_key_usage WHERE key_id = ?")
      .run(record.id);
    sqlite.prepare("DELETE FROM api_keys WHERE id = ?").run(record.id);
  }

  invalidateKeyCache();
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

/** Track usage by key string (looks up key_id automatically) */
export function trackUsageByKey(
  key: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  callType?: string
): void {
  const keys = ensureKeyCache();
  const record = keys.find((k) => k.key === key);
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
  const sevenDaysAgo = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  const thirtyDaysAgo = new Date(
    now.getTime() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

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
