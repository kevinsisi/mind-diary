import { Router, Request, Response } from "express";
import { sqlite } from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// GET /api/tags — list tags used in the current user's diary entries
router.get("/", requireAuth, (req: Request, res: Response) => {
  try {
    const tags = sqlite
      .prepare(
        `SELECT t.*, COUNT(dt.diary_id) as count
         FROM tags t
         INNER JOIN diary_entry_tags dt ON dt.tag_id = t.id
         INNER JOIN diary_entries d ON dt.diary_id = d.id
         WHERE d.user_id = ?
         GROUP BY t.id
         ORDER BY count DESC`
      )
      .all(req.userId);
    res.json({ tags });
  } catch (err: any) {
    console.error("[tags] List error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// DELETE /api/tags/:id — remove tag from current user's entries only
router.delete("/:id", requireAuth, (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const existing = sqlite
      .prepare(
        `SELECT DISTINCT t.id
         FROM tags t
         JOIN diary_entry_tags dt ON dt.tag_id = t.id
         JOIN diary_entries d ON d.id = dt.diary_id
         WHERE t.id = ? AND d.user_id = ?`
      )
      .get(id, req.userId);

    if (!existing) {
      return res.status(404).json({ error: "標籤不存在" });
    }

    sqlite.prepare(
      `DELETE FROM diary_entry_tags
       WHERE tag_id = ? AND diary_id IN (SELECT id FROM diary_entries WHERE user_id = ?)`
    ).run(id, req.userId);

    const remainingUsage = sqlite.prepare("SELECT 1 FROM diary_entry_tags WHERE tag_id = ? LIMIT 1").get(id);
    if (!remainingUsage) {
      sqlite.prepare("DELETE FROM tags WHERE id = ?").run(id);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("[tags] Delete error:", err);
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

export default router;
