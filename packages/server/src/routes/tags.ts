import { Router, Request, Response } from "express";
import { sqlite } from "../db/connection.js";

const router = Router();

// GET /api/tags — list all tags with usage count
router.get("/", (_req: Request, res: Response) => {
  try {
    const tags = sqlite
      .prepare(
        `SELECT t.*, COUNT(dt.diary_id) as count
         FROM tags t
         LEFT JOIN diary_entry_tags dt ON dt.tag_id = t.id
         GROUP BY t.id
         ORDER BY count DESC`
      )
      .all();
    res.json({ tags });
  } catch (err: any) {
    console.error("[tags] List error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// DELETE /api/tags/:id — delete tag (cascade removes junction rows)
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const existing = sqlite
      .prepare("SELECT id FROM tags WHERE id = ?")
      .get(id);

    if (!existing) {
      return res.status(404).json({ error: "標籤不存在" });
    }

    // Remove junction rows first
    sqlite.prepare("DELETE FROM diary_entry_tags WHERE tag_id = ?").run(id);

    // Remove tag
    sqlite.prepare("DELETE FROM tags WHERE id = ?").run(id);

    res.json({ success: true });
  } catch (err: any) {
    console.error("[tags] Delete error:", err);
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

export default router;
