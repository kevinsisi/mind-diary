/**
 * StorageAdapter implementation for mind-diary's two-table schema.
 *
 * Maps:
 *   api_keys         (id, key, source, suffix, is_blocked)
 *   api_key_cooldowns (id, key_id, reason, cooldown_until)
 *
 * to the ai-core ApiKey interface:
 *   { id, key, isActive, cooldownUntil, usageCount }
 */

import type { StorageAdapter, ApiKey } from "@kevinsisi/ai-core";
import { sqlite } from "../db/connection.js";

interface RawKey {
  id: number;
  key: string;
  suffix: string;
  source: string;
  is_blocked: number;
}

interface RawCooldown {
  key_id: number;
  cooldown_until: number;
}

export class MindDiaryAdapter implements StorageAdapter {
  async getKeys(): Promise<ApiKey[]> {
    const keys = sqlite
      .prepare("SELECT id, key, source, suffix, is_blocked FROM api_keys")
      .all() as RawKey[];

    const now = Date.now();
    const cooldowns = sqlite
      .prepare(
        "SELECT key_id, cooldown_until FROM api_key_cooldowns WHERE cooldown_until > ?"
      )
      .all(now) as RawCooldown[];

    const cooldownMap = new Map<number, number>(
      cooldowns.map((c) => [c.key_id, c.cooldown_until])
    );

    return keys.map((k) => ({
      id: k.id,
      key: k.key,
      isActive: k.is_blocked === 0,
      cooldownUntil: cooldownMap.get(k.id) ?? 0,
      usageCount: 0, // usage tracked separately in api_key_usage table
    }));
  }

  async updateKey(key: ApiKey): Promise<void> {
    // Handle permanent block
    if (!key.isActive) {
      sqlite
        .prepare("UPDATE api_keys SET is_blocked = 1 WHERE id = ?")
        .run(key.id);
      return;
    }

    if (key.cooldownUntil > Date.now()) {
      // Upsert cooldown record
      sqlite.prepare("DELETE FROM api_key_cooldowns WHERE key_id = ?").run(key.id);
      sqlite
        .prepare(
          "INSERT INTO api_key_cooldowns (key_id, reason, cooldown_until) VALUES (?, ?, ?)"
        )
        .run(key.id, "ai-core-managed", key.cooldownUntil);
    } else if (key.cooldownUntil === 0) {
      // Clear cooldown (successful release)
      sqlite
        .prepare("DELETE FROM api_key_cooldowns WHERE key_id = ?")
        .run(key.id);
    }
  }
}
