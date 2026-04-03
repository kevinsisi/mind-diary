import { Router, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import { sqlite } from "../db/connection.js";
import { extractText, deleteFile } from "../services/fileService.js";
import { generateSummary } from "../ai/geminiClient.js";

// ── Multer config ─────────────────────────────────────────────────
const UPLOAD_DIR = path.resolve(
  process.env.DATABASE_PATH
    ? path.dirname(process.env.DATABASE_PATH)
    : "./data",
  "uploads"
);

const ALLOWED_MIMETYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "text/plain",
  "text/markdown",
];

const ALLOWED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".txt", ".md"];

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      ALLOWED_MIMETYPES.includes(file.mimetype) ||
      ALLOWED_EXTENSIONS.includes(ext)
    ) {
      cb(null, true);
    } else {
      cb(new Error(`不支援的檔案類型: ${file.mimetype}`));
    }
  },
});

// ── Router ────────────────────────────────────────────────────────
const router = Router();

// POST /api/files — upload file
router.post("/", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "未提供檔案" });
    }

    const { originalname, mimetype, size, path: filepath } = req.file;

    // Extract text content
    const contentText = await extractText(filepath, mimetype);

    // Generate AI summary (graceful failure)
    let aiSummary: string | null = null;
    if (contentText) {
      try {
        aiSummary = await generateSummary(contentText);
      } catch (err) {
        console.error("[files] AI summary generation failed:", err);
      }
    }

    // Insert into files table
    const stmt = sqlite.prepare(`
      INSERT INTO files (filename, mimetype, size, filepath, content_text, ai_summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      originalname,
      mimetype,
      size,
      filepath,
      contentText || null,
      aiSummary
    );

    const fileId = result.lastInsertRowid;

    // Index in FTS5
    if (contentText || originalname) {
      sqlite
        .prepare(
          `INSERT INTO files_fts (rowid, content_text, filename) VALUES (?, ?, ?)`
        )
        .run(fileId, contentText || "", originalname);
    }

    // Fetch and return the created record
    const file = sqlite
      .prepare("SELECT * FROM files WHERE id = ?")
      .get(fileId);

    res.status(201).json(file);
  } catch (err: any) {
    console.error("[files] Upload error:", err);
    res.status(500).json({ error: err.message || "上傳失敗" });
  }
});

// GET /api/files — list files (paginated)
router.get("/", (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const total = sqlite
      .prepare("SELECT COUNT(*) as count FROM files")
      .get() as { count: number };

    const files = sqlite
      .prepare(
        "SELECT id, filename, mimetype, size, ai_summary, created_at FROM files ORDER BY created_at DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset);

    res.json({
      files,
      pagination: {
        page,
        limit,
        total: total.count,
        totalPages: Math.ceil(total.count / limit),
      },
    });
  } catch (err: any) {
    console.error("[files] List error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// GET /api/files/:id — get single file
router.get("/:id", (req: Request, res: Response) => {
  try {
    const file = sqlite
      .prepare("SELECT * FROM files WHERE id = ?")
      .get(Number(req.params.id));

    if (!file) {
      return res.status(404).json({ error: "檔案不存在" });
    }

    res.json(file);
  } catch (err: any) {
    console.error("[files] Get error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// DELETE /api/files/:id — delete file
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const file = sqlite
      .prepare("SELECT * FROM files WHERE id = ?")
      .get(Number(req.params.id)) as any;

    if (!file) {
      return res.status(404).json({ error: "檔案不存在" });
    }

    // Remove physical file
    await deleteFile(file.filepath);

    // Remove FTS5 entry
    sqlite.prepare("DELETE FROM files_fts WHERE rowid = ?").run(file.id);

    // Remove DB record
    sqlite.prepare("DELETE FROM files WHERE id = ?").run(file.id);

    res.json({ success: true });
  } catch (err: any) {
    console.error("[files] Delete error:", err);
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

// POST /api/files/:id/resummarize — re-generate AI summary
router.post("/:id/resummarize", async (req: Request, res: Response) => {
  try {
    const file = sqlite
      .prepare("SELECT * FROM files WHERE id = ?")
      .get(Number(req.params.id)) as any;

    if (!file) {
      return res.status(404).json({ error: "檔案不存在" });
    }

    if (!file.content_text) {
      return res.status(400).json({ error: "檔案無文字內容可供摘要" });
    }

    const aiSummary = await generateSummary(file.content_text);

    sqlite
      .prepare("UPDATE files SET ai_summary = ? WHERE id = ?")
      .run(aiSummary, file.id);

    res.json({ id: file.id, ai_summary: aiSummary });
  } catch (err: any) {
    console.error("[files] Resummarize error:", err);
    res.status(500).json({ error: err.message || "重新摘要失敗" });
  }
});

export default router;
