import { Router, Request, Response } from "express";
import { sqlite } from "../db/connection.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(optionalAuth);

function getOwnedFolder(folderId: unknown, userId: number) {
  if (folderId === undefined) return undefined;
  if (folderId === null) return null;

  const parsed = Number(folderId);
  if (!Number.isInteger(parsed) || parsed <= 0) return false;

  const folder = sqlite
    .prepare("SELECT id FROM folders WHERE id = ? AND user_id = ?")
    .get(parsed, userId) as { id: number } | undefined;

  return folder ? parsed : false;
}

// GET /api/folders — list all folders (flat list with parent_id)
router.get("/", (req: Request, res: Response) => {
  try {
    const folders = sqlite
      .prepare("SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC")
      .all(req.userId);
    res.json({ folders });
  } catch (err: any) {
    console.error("[folders] List error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// POST /api/folders — create folder (requires login)
router.post("/", requireAuth, (req: Request, res: Response) => {
  try {
    const { name, parent_id, icon } = req.body;

    if (!name) {
      return res.status(400).json({ error: "資料夾名稱為必填" });
    }

    const parentId = getOwnedFolder(parent_id, req.userId);
    if (parentId === false) {
      return res.status(400).json({ error: "無效的父資料夾" });
    }

    const result = sqlite
      .prepare("INSERT INTO folders (name, parent_id, icon, user_id) VALUES (?, ?, ?, ?)")
      .run(name, parentId ?? null, icon || "📁", req.userId);

    const folder = sqlite
      .prepare("SELECT * FROM folders WHERE id = ? AND user_id = ?")
      .get(result.lastInsertRowid, req.userId);

    res.status(201).json(folder);
  } catch (err: any) {
    console.error("[folders] Create error:", err);
    res.status(500).json({ error: err.message || "建立失敗" });
  }
});

// PUT /api/folders/:id — update folder (requires login)
router.put("/:id", requireAuth, (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = sqlite
      .prepare("SELECT * FROM folders WHERE id = ? AND user_id = ?")
      .get(id, req.userId) as any;

    if (!existing) {
      return res.status(404).json({ error: "資料夾不存在" });
    }

    const { name, icon, parent_id, sort_order } = req.body;
    const ownedParentId = getOwnedFolder(parent_id, req.userId);
    if (ownedParentId === false) {
      return res.status(400).json({ error: "無效的父資料夾" });
    }

    const newName = name ?? existing.name;
    const newIcon = icon ?? existing.icon;
    const newParentId = ownedParentId !== undefined ? ownedParentId : existing.parent_id;
    const newSortOrder = sort_order !== undefined ? sort_order : existing.sort_order;

    sqlite
      .prepare("UPDATE folders SET name = ?, icon = ?, parent_id = ?, sort_order = ? WHERE id = ? AND user_id = ?")
      .run(newName, newIcon, newParentId, newSortOrder, id, req.userId);

    const folder = sqlite
      .prepare("SELECT * FROM folders WHERE id = ? AND user_id = ?")
      .get(id, req.userId);

    res.json(folder);
  } catch (err: any) {
    console.error("[folders] Update error:", err);
    res.status(500).json({ error: err.message || "更新失敗" });
  }
});

// DELETE /api/folders/:id — delete folder (requires login)
router.delete("/:id", requireAuth, (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const existing = sqlite
      .prepare("SELECT id FROM folders WHERE id = ? AND user_id = ?")
      .get(id, req.userId);

    if (!existing) {
      return res.status(404).json({ error: "資料夾不存在" });
    }

    // Move diary entries in this folder (and subfolders) to no folder
    sqlite
      .prepare("UPDATE diary_entries SET folder_id = NULL WHERE folder_id = ? AND user_id = ?")
      .run(id, req.userId);

    // Move subfolder entries to no folder and reparent subfolders
    const subfolders = sqlite
      .prepare("SELECT id FROM folders WHERE parent_id = ? AND user_id = ?")
      .all(id, req.userId) as { id: number }[];

    for (const sub of subfolders) {
      sqlite
        .prepare("UPDATE diary_entries SET folder_id = NULL WHERE folder_id = ? AND user_id = ?")
        .run(sub.id, req.userId);
    }

    // Delete subfolders
    sqlite.prepare("DELETE FROM folders WHERE parent_id = ? AND user_id = ?").run(id, req.userId);

    // Delete the folder itself
    sqlite.prepare("DELETE FROM folders WHERE id = ? AND user_id = ?").run(id, req.userId);

    res.json({ success: true });
  } catch (err: any) {
    console.error("[folders] Delete error:", err);
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

export default router;
