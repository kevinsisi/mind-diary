import { Router, Request, Response } from "express";
import { sqlite } from "../db/connection.js";

const router = Router();

interface SearchResult {
  id: number;
  source: "file" | "diary";
  title: string;
  snippet: string;
  created_at: string;
  rank: number;
  tags?: string[];
}

function getEntryTags(entryId: number): string[] {
  const rows = sqlite.prepare(
    `SELECT t.name FROM tags t JOIN diary_entry_tags dt ON dt.tag_id = t.id WHERE dt.diary_id = ?`
  ).all(entryId) as { name: string }[];
  return rows.map(r => r.name);
}

// GET /api/search?q=...&page=1&limit=20 — unified search
router.get("/", (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string)?.trim();
    if (!q) {
      return res.status(400).json({ error: "搜尋關鍵字不能為空" });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const results: SearchResult[] = [];

    // Search files FTS5
    try {
      const fileResults = sqlite
        .prepare(
          `SELECT
            f.id,
            'file' as source,
            f.filename as title,
            snippet(files_fts, 0, '<mark>', '</mark>', '...', 48) as snippet,
            f.created_at,
            files_fts.rank
          FROM files_fts
          JOIN files f ON f.id = files_fts.rowid
          WHERE files_fts MATCH ?
          ORDER BY files_fts.rank`
        )
        .all(q) as SearchResult[];

      results.push(...fileResults);
    } catch {
      // FTS match can fail on syntax errors; skip
    }

    // Search diary FTS5 (title + content)
    const foundDiaryIds = new Set<number>();
    try {
      const diaryResults = sqlite
        .prepare(
          `SELECT
            d.id,
            'diary' as source,
            d.title,
            snippet(diary_fts, 1, '<mark>', '</mark>', '...', 48) as snippet,
            d.created_at,
            diary_fts.rank
          FROM diary_fts
          JOIN diary_entries d ON d.id = diary_fts.rowid
          WHERE diary_fts MATCH ?
          ORDER BY diary_fts.rank`
        )
        .all(q) as SearchResult[];

      for (const r of diaryResults) {
        r.tags = getEntryTags(r.id);
        foundDiaryIds.add(r.id);
      }
      results.push(...diaryResults);
    } catch {
      // FTS match can fail on syntax errors; skip
    }

    // Search diary by tag name (LIKE match)
    try {
      const tagResults = sqlite
        .prepare(
          `SELECT DISTINCT
            d.id,
            'diary' as source,
            d.title,
            SUBSTR(d.content, 1, 100) as snippet,
            d.created_at,
            0 as rank
          FROM diary_entries d
          JOIN diary_entry_tags dt ON dt.diary_id = d.id
          JOIN tags t ON t.id = dt.tag_id
          WHERE t.name LIKE ?
          ORDER BY d.created_at DESC`
        )
        .all(`%${q}%`) as SearchResult[];

      for (const r of tagResults) {
        if (!foundDiaryIds.has(r.id)) {
          r.tags = getEntryTags(r.id);
          results.push(r);
        }
      }
    } catch {
      // skip
    }

    // Search chat sessions by title
    try {
      const chatResults = sqlite
        .prepare(
          `SELECT
            s.id,
            'chat' as source,
            s.title,
            COALESCE(
              (SELECT SUBSTR(content, 1, 100) FROM chat_messages WHERE session_id = s.id AND role = 'assistant' ORDER BY created_at DESC LIMIT 1),
              ''
            ) as snippet,
            s.created_at,
            0 as rank
          FROM chat_sessions s
          WHERE s.title LIKE ?
          ORDER BY s.created_at DESC`
        )
        .all(`%${q}%`) as SearchResult[];

      results.push(...chatResults);
    } catch {
      // skip
    }

    // Sort combined results by FTS5 rank (lower is better)
    results.sort((a, b) => a.rank - b.rank);

    const total = results.length;
    const paginated = results.slice(offset, offset + limit);

    res.json({
      results: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("[search] Error:", err);
    res.status(500).json({ error: err.message || "搜尋失敗" });
  }
});

export default router;
