import { Router, Request, Response } from "express";
import { sqlite } from "../db/connection.js";
import { generateReflection } from "../ai/geminiClient.js";

const router = Router();

// POST /api/diary — create entry
router.post("/", async (req: Request, res: Response) => {
  try {
    const { title, content, mood } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: "標題和內容為必填" });
    }

    const stmt = sqlite.prepare(`
      INSERT INTO diary_entries (title, content, mood)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(title, content, mood || null);
    const entryId = result.lastInsertRowid;

    // Index in FTS5
    sqlite
      .prepare(
        `INSERT INTO diary_fts (rowid, title, content) VALUES (?, ?, ?)`
      )
      .run(entryId, title, content);

    // Auto-trigger AI reflection (graceful failure)
    let aiReflection: string | null = null;
    try {
      aiReflection = await generateReflection(content);
      sqlite
        .prepare("UPDATE diary_entries SET ai_reflection = ? WHERE id = ?")
        .run(aiReflection, entryId);
    } catch (err) {
      console.error("[diary] AI reflection failed:", err);
    }

    const entry = sqlite
      .prepare("SELECT * FROM diary_entries WHERE id = ?")
      .get(entryId);

    res.status(201).json(entry);
  } catch (err: any) {
    console.error("[diary] Create error:", err);
    res.status(500).json({ error: err.message || "建立失敗" });
  }
});

// GET /api/diary — list entries (paginated)
router.get("/", (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const total = sqlite
      .prepare("SELECT COUNT(*) as count FROM diary_entries")
      .get() as { count: number };

    const entries = sqlite
      .prepare(
        "SELECT id, title, content, mood, ai_reflection, created_at, updated_at FROM diary_entries ORDER BY created_at DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset);

    res.json({
      entries,
      pagination: {
        page,
        limit,
        total: total.count,
        totalPages: Math.ceil(total.count / limit),
      },
    });
  } catch (err: any) {
    console.error("[diary] List error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// GET /api/diary/:id — get single entry
router.get("/:id", (req: Request, res: Response) => {
  try {
    const entry = sqlite
      .prepare("SELECT * FROM diary_entries WHERE id = ?")
      .get(Number(req.params.id));

    if (!entry) {
      return res.status(404).json({ error: "日記不存在" });
    }

    res.json(entry);
  } catch (err: any) {
    console.error("[diary] Get error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// PUT /api/diary/:id — update entry
router.put("/:id", (req: Request, res: Response) => {
  try {
    const { title, content, mood } = req.body;
    const id = Number(req.params.id);

    const existing = sqlite
      .prepare("SELECT * FROM diary_entries WHERE id = ?")
      .get(id) as any;

    if (!existing) {
      return res.status(404).json({ error: "日記不存在" });
    }

    const newTitle = title ?? existing.title;
    const newContent = content ?? existing.content;
    const newMood = mood !== undefined ? mood : existing.mood;

    sqlite
      .prepare(
        `UPDATE diary_entries SET title = ?, content = ?, mood = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(newTitle, newContent, newMood, id);

    // Update FTS5 entry (delete + re-insert)
    sqlite.prepare("DELETE FROM diary_fts WHERE rowid = ?").run(id);
    sqlite
      .prepare(
        `INSERT INTO diary_fts (rowid, title, content) VALUES (?, ?, ?)`
      )
      .run(id, newTitle, newContent);

    const entry = sqlite
      .prepare("SELECT * FROM diary_entries WHERE id = ?")
      .get(id);

    res.json(entry);
  } catch (err: any) {
    console.error("[diary] Update error:", err);
    res.status(500).json({ error: err.message || "更新失敗" });
  }
});

// DELETE /api/diary/:id — delete entry
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const existing = sqlite
      .prepare("SELECT id FROM diary_entries WHERE id = ?")
      .get(id);

    if (!existing) {
      return res.status(404).json({ error: "日記不存在" });
    }

    // Remove FTS5 entry
    sqlite.prepare("DELETE FROM diary_fts WHERE rowid = ?").run(id);

    // Remove DB record
    sqlite.prepare("DELETE FROM diary_entries WHERE id = ?").run(id);

    res.json({ success: true });
  } catch (err: any) {
    console.error("[diary] Delete error:", err);
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

// POST /api/diary/:id/reflect — re-generate AI reflection
router.post("/:id/reflect", async (req: Request, res: Response) => {
  try {
    const entry = sqlite
      .prepare("SELECT * FROM diary_entries WHERE id = ?")
      .get(Number(req.params.id)) as any;

    if (!entry) {
      return res.status(404).json({ error: "日記不存在" });
    }

    const aiReflection = await generateReflection(entry.content);

    sqlite
      .prepare("UPDATE diary_entries SET ai_reflection = ? WHERE id = ?")
      .run(aiReflection, entry.id);

    res.json({ id: entry.id, ai_reflection: aiReflection });
  } catch (err: any) {
    console.error("[diary] Reflect error:", err);
    res.status(500).json({ error: err.message || "AI 反思生成失敗" });
  }
});

export default router;
