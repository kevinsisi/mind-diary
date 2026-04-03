import { Router, Request, Response } from "express";
import {
  getKeyList,
  addApiKey,
  removeApiKey,
  invalidateKeyCache,
  getUsageStats,
} from "../ai/keyPool.js";
import { sqlite } from "../db/connection.js";

const router = Router();

// GET /api/settings/keys — list all keys with usage stats
router.get("/keys", (_req: Request, res: Response) => {
  try {
    const keys = getKeyList();
    res.json({ keys });
  } catch (err: any) {
    console.error("[settings] List keys error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// POST /api/settings/keys — add new key
router.post("/keys", (req: Request, res: Response) => {
  try {
    const { key } = req.body;

    if (!key || typeof key !== "string") {
      return res.status(400).json({ error: "金鑰不能為空" });
    }

    const trimmed = key.trim();

    // Validate format
    if (!trimmed.startsWith("AIza") || trimmed.length < 20) {
      return res.status(400).json({
        error: "Gemini 金鑰格式不正確（應以 AIza 開頭且長度至少 20 字元）",
      });
    }

    addApiKey(trimmed);
    res.status(201).json({ success: true, suffix: trimmed.slice(-6) });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      return res.status(409).json({ error: "此金鑰已存在" });
    }
    console.error("[settings] Add key error:", err);
    res.status(500).json({ error: err.message || "新增失敗" });
  }
});

// DELETE /api/settings/keys/:suffix — remove key
router.delete("/keys/:suffix", (req: Request, res: Response) => {
  try {
    const suffix = req.params.suffix as string;
    const removed = removeApiKey(suffix);

    if (!removed) {
      return res.status(404).json({ error: "找不到此金鑰" });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("[settings] Remove key error:", err);
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

// POST /api/settings/keys/batch — bulk import
router.post("/keys/batch", (req: Request, res: Response) => {
  try {
    const { keys } = req.body;

    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: "請提供金鑰陣列" });
    }

    // Filter valid keys
    const validKeys = keys
      .map((k: any) => (typeof k === "string" ? k.trim() : ""))
      .filter(
        (k: string) => k.startsWith("AIza") && k.length >= 20
      );

    if (validKeys.length === 0) {
      return res.status(400).json({ error: "沒有有效的金鑰" });
    }

    let added = 0;
    let skipped = 0;

    const insertStmt = sqlite.prepare(
      `INSERT OR IGNORE INTO api_keys (key, suffix, source) VALUES (?, ?, 'db')`
    );

    const transaction = sqlite.transaction((keysToInsert: string[]) => {
      for (const key of keysToInsert) {
        const suffix = key.slice(-6);
        const result = insertStmt.run(key, suffix);
        if (result.changes > 0) added++;
        else skipped++;
      }
    });

    transaction(validKeys);
    invalidateKeyCache();

    res.json({ added, skipped, total: validKeys.length });
  } catch (err: any) {
    console.error("[settings] Batch import error:", err);
    res.status(500).json({ error: err.message || "批次匯入失敗" });
  }
});

// POST /api/settings/keys/validate — validate a single key
router.post("/keys/validate", (req: Request, res: Response) => {
  try {
    const { key } = req.body;

    if (!key || typeof key !== "string") {
      return res.json({ valid: false, reason: "金鑰不能為空" });
    }

    const trimmed = key.trim();

    if (trimmed.length < 20) {
      return res.json({ valid: false, reason: "金鑰長度不足" });
    }

    if (!trimmed.startsWith("AIza")) {
      return res.json({ valid: false, reason: "Gemini 金鑰應以 AIza 開頭" });
    }

    if (
      trimmed.includes("YOUR_") ||
      trimmed.includes("PLACEHOLDER") ||
      trimmed.includes("xxx")
    ) {
      return res.json({ valid: false, reason: "金鑰包含佔位符文字" });
    }

    res.json({ valid: true });
  } catch (err: any) {
    console.error("[settings] Validate key error:", err);
    res.status(500).json({ error: err.message || "驗證失敗" });
  }
});

// GET /api/settings/usage — aggregated usage stats
router.get("/usage", (_req: Request, res: Response) => {
  try {
    const stats = getUsageStats();
    res.json(stats);
  } catch (err: any) {
    console.error("[settings] Usage stats error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

export default router;
