import { Router, Request, Response } from "express";
import { sqlite } from "../db/connection.js";

const router = Router();

// GET /api/folders — list all folders (flat list with parent_id)
router.get("/", (_req: Request, res: Response) => {
  try {
    const folders = sqlite
      .prepare("SELECT * FROM folders ORDER BY sort_order ASC, created_at ASC")
      .all();
    res.json({ folders });
  } catch (err: any) {
    console.error("[folders] List error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// POST /api/folders — create folder
router.post("/", (req: Request, res: Response) => {
  try {
    const { name, parent_id, icon } = req.body;

    if (!name) {
      return res.status(400).json({ error: "資料夾名稱為必填" });
    }

    const result = sqlite
      .prepare("INSERT INTO folders (name, parent_id, icon) VALUES (?, ?, ?)")
      .run(name, parent_id || null, icon || "📁");

    const folder = sqlite
      .prepare("SELECT * FROM folders WHERE id = ?")
      .get(result.lastInsertRowid);

    res.status(201).json(folder);
  } catch (err: any) {
    console.error("[folders] Create error:", err);
    res.status(500).json({ error: err.message || "建立失敗" });
  }
});

// PUT /api/folders/:id — update folder
router.put("/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = sqlite
      .prepare("SELECT * FROM folders WHERE id = ?")
      .get(id) as any;

    if (!existing) {
      return res.status(404).json({ error: "資料夾不存在" });
    }

    const { name, icon, parent_id, sort_order } = req.body;

    const newName = name ?? existing.name;
    const newIcon = icon ?? existing.icon;
    const newParentId = parent_id !== undefined ? (parent_id || null) : existing.parent_id;
    const newSortOrder = sort_order !== undefined ? sort_order : existing.sort_order;

    sqlite
      .prepare("UPDATE folders SET name = ?, icon = ?, parent_id = ?, sort_order = ? WHERE id = ?")
      .run(newName, newIcon, newParentId, newSortOrder, id);

    const folder = sqlite
      .prepare("SELECT * FROM folders WHERE id = ?")
      .get(id);

    res.json(folder);
  } catch (err: any) {
    console.error("[folders] Update error:", err);
    res.status(500).json({ error: err.message || "更新失敗" });
  }
});

// DELETE /api/folders/:id — delete folder (move entries to null folder_id)
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const existing = sqlite
      .prepare("SELECT id FROM folders WHERE id = ?")
      .get(id);

    if (!existing) {
      return res.status(404).json({ error: "資料夾不存在" });
    }

    // Move diary entries in this folder (and subfolders) to no folder
    sqlite
      .prepare("UPDATE diary_entries SET folder_id = NULL WHERE folder_id = ?")
      .run(id);

    // Move subfolder entries to no folder and reparent subfolders
    const subfolders = sqlite
      .prepare("SELECT id FROM folders WHERE parent_id = ?")
      .all(id) as { id: number }[];

    for (const sub of subfolders) {
      sqlite
        .prepare("UPDATE diary_entries SET folder_id = NULL WHERE folder_id = ?")
        .run(sub.id);
    }

    // Delete subfolders
    sqlite.prepare("DELETE FROM folders WHERE parent_id = ?").run(id);

    // Delete the folder itself
    sqlite.prepare("DELETE FROM folders WHERE id = ?").run(id);

    res.json({ success: true });
  } catch (err: any) {
    console.error("[folders] Delete error:", err);
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

export default router;
