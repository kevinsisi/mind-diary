import { Router, Request, Response } from "express";
import { sqlite } from "../db/connection.js";
import { optionalAuth } from "../middleware/auth.js";

const router = Router();

// Search is accessible to guests; results are scoped to current user (or guest public space)
router.use(optionalAuth);

interface SearchResult {
  id: number;
  source: "file" | "diary" | "chat";
  title: string;
  snippet: string;
  created_at: string;
  rank: number;
  tags?: string[];
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildHighlightedSnippet(text: string | null | undefined, query: string, fallback = ""): string {
  const source = (text || fallback || "").trim();
  if (!source) return "";

  const normalizedSource = source.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const matchIndex = normalizedSource.indexOf(normalizedQuery);
  const start = matchIndex >= 0 ? Math.max(0, matchIndex - 24) : 0;
  const end = matchIndex >= 0 ? Math.min(source.length, matchIndex + query.length + 48) : Math.min(source.length, 96);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";
  const excerpt = source.slice(start, end);

  if (matchIndex < 0) {
    return `${prefix}${escapeHtml(excerpt)}${suffix}`;
  }

  const localIndex = matchIndex - start;
  const before = escapeHtml(excerpt.slice(0, localIndex));
  const match = escapeHtml(excerpt.slice(localIndex, localIndex + query.length));
  const after = escapeHtml(excerpt.slice(localIndex + query.length));
  return `${prefix}${before}<mark>${match}</mark>${after}${suffix}`;
}

function computeScore(title: string, snippetSource: string, query: string, base: number): number {
  const normalizedTitle = title.toLowerCase();
  const normalizedSnippet = snippetSource.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let score = base;

  if (normalizedTitle === normalizedQuery) score += 140;
  else if (normalizedTitle.includes(normalizedQuery)) score += 90;

  if (normalizedSnippet.includes(normalizedQuery)) score += 35;

  return score;
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
    const userId = req.userId;
    const normalizedQuery = q.toLowerCase();

    const results: SearchResult[] = [];
    const seen = new Set<string>();

    const pushResult = (result: SearchResult) => {
      const key = `${result.source}:${result.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(result);
    };

    // Search files FTS5 — JOIN main table to filter by user_id
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
          WHERE files_fts MATCH ? AND f.user_id = ?
          ORDER BY files_fts.rank`
        )
        .all(q, userId) as Array<SearchResult & { content_text?: string | null; filename?: string }>;

      for (const result of fileResults) {
        pushResult({
          ...result,
          rank: computeScore(result.title, result.snippet || result.content_text || "", q, 220),
        });
      }
    } catch {
      // FTS match can fail on syntax errors; skip
    }

    // Fallback: LIKE search for files (filename/content_text/ai_summary)
    try {
      const fileLikeResults = sqlite
        .prepare(
          `SELECT
            f.id,
            'file' as source,
            f.filename as title,
            f.content_text,
            f.ai_summary,
            f.created_at,
            0 as rank
          FROM files f
          WHERE (f.filename LIKE ? OR f.content_text LIKE ? OR f.ai_summary LIKE ?) AND f.user_id = ?
          ORDER BY f.created_at DESC`
        )
        .all(`%${q}%`, `%${q}%`, `%${q}%`, userId) as Array<{ id: number; source: 'file'; title: string; content_text: string | null; ai_summary: string | null; created_at: string; rank: number }>;

      for (const result of fileLikeResults) {
        pushResult({
          id: result.id,
          source: result.source,
          title: result.title,
          snippet: buildHighlightedSnippet(result.content_text || result.ai_summary || result.title, q, result.title),
          created_at: result.created_at,
          rank: computeScore(result.title, `${result.content_text || ''} ${result.ai_summary || ''}`, q, 120),
        });
      }
    } catch {
      // skip
    }

    // Search diary FTS5 (title + content) — filter by user_id
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
          WHERE diary_fts MATCH ? AND d.user_id = ?
          ORDER BY diary_fts.rank`
        )
        .all(q, userId) as SearchResult[];

      for (const r of diaryResults) {
        r.tags = getEntryTags(r.id);
        r.rank = computeScore(r.title, r.snippet, q, 240);
        pushResult(r);
      }
    } catch {
      // FTS match can fail on syntax errors; skip
    }

    // Fallback: LIKE search on diary title + content (catches Chinese phrases FTS5 misses)
    try {
      const likeResults = sqlite
        .prepare(
          `SELECT
            d.id,
            'diary' as source,
            d.title,
            SUBSTR(d.content, 1, 100) as snippet,
            d.created_at,
            0 as rank
          FROM diary_entries d
          WHERE (d.title LIKE ? OR d.content LIKE ?) AND d.user_id = ?
          ORDER BY d.created_at DESC`
        )
        .all(`%${q}%`, `%${q}%`, userId) as SearchResult[];

      for (const r of likeResults) {
        r.tags = getEntryTags(r.id);
        r.snippet = buildHighlightedSnippet(r.snippet, q, r.title);
        r.rank = computeScore(r.title, r.snippet, q, 160);
        pushResult(r);
      }
    } catch {
      // skip
    }

    // Search diary image descriptions (images are analyzed on upload)
    try {
      const imageResults = sqlite
        .prepare(
          `SELECT DISTINCT
            d.id,
            'diary' as source,
            d.title,
            di.ai_description as snippet,
            d.created_at,
            0 as rank
          FROM diary_entries d
          JOIN diary_images di ON di.diary_id = d.id
          WHERE di.ai_description LIKE ? AND d.user_id = ?
          ORDER BY d.created_at DESC`
        )
        .all(`%${q}%`, userId) as SearchResult[];

      for (const r of imageResults) {
        r.tags = getEntryTags(r.id);
        r.snippet = buildHighlightedSnippet(r.snippet, q, r.title);
        r.rank = computeScore(r.title, r.snippet, q, 145);
        pushResult(r);
      }
    } catch {
      // skip
    }

    // Search diary by tag name (LIKE match) — filter by user_id
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
          WHERE t.name LIKE ? AND d.user_id = ?
          ORDER BY d.created_at DESC`
        )
        .all(`%${q}%`, userId) as SearchResult[];

      for (const r of tagResults) {
        r.tags = getEntryTags(r.id);
        r.snippet = buildHighlightedSnippet(r.snippet, q, r.title);
        r.rank = computeScore(r.title, r.tags.join(" "), q, 130);
        pushResult(r);
      }
    } catch {
      // skip
    }

    // Search chat sessions by title or message content — filter by user_id
    try {
      const chatTitleResults = sqlite
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
          WHERE s.title LIKE ? AND s.user_id = ?
          ORDER BY s.created_at DESC`
        )
        .all(`%${q}%`, userId) as SearchResult[];

      for (const result of chatTitleResults) {
        result.snippet = buildHighlightedSnippet(result.snippet || result.title, q, result.title);
        result.rank = computeScore(result.title, result.snippet, q, 170);
        pushResult(result);
      }

      const chatMessageResults = sqlite
        .prepare(
          `SELECT
            s.id,
            'chat' as source,
            s.title,
            cm.content as snippet,
            s.created_at,
            0 as rank
          FROM chat_sessions s
          JOIN chat_messages cm ON cm.session_id = s.id
          WHERE cm.content LIKE ? AND s.user_id = ?
          ORDER BY cm.created_at DESC`
        )
        .all(`%${q}%`, userId) as SearchResult[];

      for (const result of chatMessageResults) {
        result.snippet = buildHighlightedSnippet(result.snippet, q, result.title);
        result.rank = computeScore(result.title, result.snippet, q, 155);
        pushResult(result);
      }
    } catch {
      // skip
    }

    // Sort by relevance first, then newest first.
    results.sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

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
