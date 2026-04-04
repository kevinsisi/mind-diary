import { Router, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { sqlite } from "../db/connection.js";
import { analyzeImage } from "../ai/geminiClient.js";

// ── Multer config ─────────────────────────────────────────────────────
const IMAGES_DIR = path.resolve(
  process.env.DATABASE_PATH
    ? path.dirname(process.env.DATABASE_PATH)
    : "./data",
  "images"
);

const ALLOWED_IMAGE_MIMETYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    cb(null, IMAGES_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIMETYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`不支援的圖片格式: ${file.mimetype}`));
    }
  },
});

// ── Router ────────────────────────────────────────────────────────────
const router = Router({ mergeParams: true });

// POST /api/diary/:id/images — upload image(s) to a diary entry
router.post("/", upload.array("images", 10), async (req: Request, res: Response) => {
  try {
    const diaryId = Number(req.params.id);

    const entry = sqlite
      .prepare("SELECT id FROM diary_entries WHERE id = ?")
      .get(diaryId);
    if (!entry) {
      return res.status(404).json({ error: "日記不存在" });
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "未提供圖片" });
    }

    const saved = [];

    for (const file of files) {
      // AI vision analysis (graceful failure)
      let aiDescription: string | null = null;
      try {
        const buf = fs.readFileSync(file.path);
        const result = await analyzeImage(buf, file.mimetype, "請描述這張圖片的內容，包括主要元素、色彩、情境等細節。");
        aiDescription = result.text;
      } catch (err) {
        console.error("[diaryImages] AI analysis failed:", err);
      }

      const row = sqlite
        .prepare(
          `INSERT INTO diary_images (diary_id, filename, filepath, mimetype, size, ai_description)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(diaryId, file.originalname, file.path, file.mimetype, file.size, aiDescription);

      const saved_row = sqlite
        .prepare("SELECT * FROM diary_images WHERE id = ?")
        .get(row.lastInsertRowid) as any;
      saved.push({ ...saved_row, url: `/images/${path.basename(saved_row.filepath)}` });
    }

    res.status(201).json(saved);
  } catch (err: any) {
    console.error("[diaryImages] Upload error:", err);
    res.status(500).json({ error: err.message || "上傳失敗" });
  }
});

// GET /api/diary/:id/images — list images for a diary entry
router.get("/", (req: Request, res: Response) => {
  try {
    const diaryId = Number(req.params.id);

    const entry = sqlite
      .prepare("SELECT id FROM diary_entries WHERE id = ?")
      .get(diaryId);
    if (!entry) {
      return res.status(404).json({ error: "日記不存在" });
    }

    const rows = sqlite
      .prepare(
        "SELECT id, diary_id, filename, filepath, mimetype, size, ai_description, created_at FROM diary_images WHERE diary_id = ? ORDER BY created_at ASC"
      )
      .all(diaryId) as any[];

    res.json(rows.map(r => ({ ...r, url: `/images/${path.basename(r.filepath)}` })));
  } catch (err: any) {
    console.error("[diaryImages] List error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// DELETE /api/diary/:id/images/:imageId — remove image from diary entry
router.delete("/:imageId", (req: Request, res: Response) => {
  try {
    const diaryId = Number(req.params.id);
    const imageId = Number(req.params.imageId);

    const image = sqlite
      .prepare("SELECT * FROM diary_images WHERE id = ? AND diary_id = ?")
      .get(imageId, diaryId) as any;

    if (!image) {
      return res.status(404).json({ error: "圖片不存在" });
    }

    // Remove physical file (ignore errors if file missing)
    try { fs.unlinkSync(image.filepath); } catch {}

    sqlite.prepare("DELETE FROM diary_images WHERE id = ?").run(imageId);

    res.json({ success: true });
  } catch (err: any) {
    console.error("[diaryImages] Delete error:", err);
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

export default router;
export { IMAGES_DIR };
