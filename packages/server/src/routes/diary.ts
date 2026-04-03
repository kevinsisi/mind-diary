import { Router, Request, Response } from "express";
import { sqlite } from "../db/connection.js";
import { generateReflection, generateAutoTags } from "../ai/geminiClient.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────

const TAG_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];

function tagColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

function getEntryTags(entryId: number): string[] {
  const rows = sqlite.prepare(
    `SELECT t.name FROM tags t JOIN diary_entry_tags dt ON dt.tag_id = t.id WHERE dt.diary_id = ?`
  ).all(entryId) as { name: string }[];
  return rows.map(r => r.name);
}

function upsertTagsForEntry(entryId: number, tagNames: string[]): void {
  // Remove existing junction rows
  sqlite.prepare("DELETE FROM diary_entry_tags WHERE diary_id = ?").run(entryId);

  for (const name of tagNames) {
    const color = tagColor(name);
    sqlite.prepare(
      "INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)"
    ).run(name, color);

    const tag = sqlite.prepare("SELECT id FROM tags WHERE name = ?").get(name) as { id: number };
    sqlite.prepare(
      "INSERT OR IGNORE INTO diary_entry_tags (diary_id, tag_id) VALUES (?, ?)"
    ).run(entryId, tag.id);
  }
}

// POST /api/diary — create entry
router.post("/", async (req: Request, res: Response) => {
  try {
    const { title, content, mood, folder_id } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: "標題和內容為必填" });
    }

    const stmt = sqlite.prepare(`
      INSERT INTO diary_entries (title, content, mood, folder_id)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(title, content, mood || null, folder_id || null);
    const entryId = result.lastInsertRowid as number;

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

    // Auto-generate tags (graceful failure)
    let tags: string[] = [];
    try {
      tags = await generateAutoTags(content, title);
      if (tags.length > 0) {
        upsertTagsForEntry(entryId, tags);
      }
    } catch (err) {
      console.error("[diary] AI auto-tag failed:", err);
    }

    const entry = sqlite
      .prepare("SELECT * FROM diary_entries WHERE id = ?")
      .get(entryId);

    res.status(201).json({ ...entry as any, tags });
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
    const folderId = req.query.folder_id ? Number(req.query.folder_id) : null;
    const tagFilter = req.query.tag as string | undefined;

    let countSql = "SELECT COUNT(DISTINCT d.id) as count FROM diary_entries d";
    let querySql = "SELECT DISTINCT d.id, d.title, d.content, d.mood, d.ai_reflection, d.folder_id, d.created_at, d.updated_at FROM diary_entries d";
    const joins: string[] = [];
    const conditions: string[] = [];
    const params: any[] = [];

    if (tagFilter) {
      joins.push("JOIN diary_entry_tags dt ON dt.diary_id = d.id JOIN tags t ON t.id = dt.tag_id");
      conditions.push("t.name = ?");
      params.push(tagFilter);
    }

    if (folderId !== null) {
      conditions.push("d.folder_id = ?");
      params.push(folderId);
    }

    const joinStr = joins.length > 0 ? " " + joins.join(" ") : "";
    const whereStr = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

    const total = sqlite
      .prepare(countSql + joinStr + whereStr)
      .get(...params) as { count: number };

    const entries = sqlite
      .prepare(querySql + joinStr + whereStr + " ORDER BY d.created_at DESC LIMIT ? OFFSET ?")
      .all(...params, limit, offset) as any[];

    // Attach tags to each entry
    const entriesWithTags = entries.map(e => ({
      ...e,
      tags: getEntryTags(e.id),
    }));

    res.json({
      entries: entriesWithTags,
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
      .get(Number(req.params.id)) as any;

    if (!entry) {
      return res.status(404).json({ error: "日記不存在" });
    }

    res.json({ ...entry, tags: getEntryTags(entry.id) });
  } catch (err: any) {
    console.error("[diary] Get error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// PUT /api/diary/:id — update entry
router.put("/:id", (req: Request, res: Response) => {
  try {
    const { title, content, mood, folder_id, tags } = req.body;
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
    const newFolderId = folder_id !== undefined ? (folder_id || null) : existing.folder_id;

    sqlite
      .prepare(
        `UPDATE diary_entries SET title = ?, content = ?, mood = ?, folder_id = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(newTitle, newContent, newMood, newFolderId, id);

    // Update FTS5 entry (delete + re-insert)
    sqlite.prepare("DELETE FROM diary_fts WHERE rowid = ?").run(id);
    sqlite
      .prepare(
        `INSERT INTO diary_fts (rowid, title, content) VALUES (?, ?, ?)`
      )
      .run(id, newTitle, newContent);

    // Update tags if provided
    if (Array.isArray(tags)) {
      upsertTagsForEntry(id, tags);
    }

    const entry = sqlite
      .prepare("SELECT * FROM diary_entries WHERE id = ?")
      .get(id) as any;

    res.json({ ...entry, tags: getEntryTags(id) });
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

    // Remove tag junctions
    sqlite.prepare("DELETE FROM diary_entry_tags WHERE diary_id = ?").run(id);

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
