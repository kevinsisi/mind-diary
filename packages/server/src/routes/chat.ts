import { Router, Request, Response } from "express";
import { sqlite } from "../db/connection.js";
import { chatWithContext } from "../ai/geminiClient.js";

const router = Router();

// POST /api/chat/sessions — create new session
router.post("/sessions", (req: Request, res: Response) => {
  try {
    const title = req.body.title || "新對話";
    const result = sqlite
      .prepare("INSERT INTO chat_sessions (title) VALUES (?)")
      .run(title);

    const session = sqlite
      .prepare("SELECT * FROM chat_sessions WHERE id = ?")
      .get(result.lastInsertRowid);

    res.status(201).json(session);
  } catch (err: any) {
    console.error("[chat] Create session error:", err);
    res.status(500).json({ error: err.message || "建立失敗" });
  }
});

// GET /api/chat/sessions — list sessions with last message preview
router.get("/sessions", (req: Request, res: Response) => {
  try {
    const sessions = sqlite
      .prepare(
        `SELECT s.*,
          (SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count
        FROM chat_sessions s
        ORDER BY s.created_at DESC`
      )
      .all();

    res.json({ sessions });
  } catch (err: any) {
    console.error("[chat] List sessions error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// DELETE /api/chat/sessions/:id — delete session and all messages
router.delete("/sessions/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const session = sqlite
      .prepare("SELECT id FROM chat_sessions WHERE id = ?")
      .get(id);

    if (!session) {
      return res.status(404).json({ error: "對話不存在" });
    }

    // Delete messages first, then session
    sqlite
      .prepare("DELETE FROM chat_messages WHERE session_id = ?")
      .run(id);
    sqlite.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);

    res.json({ success: true });
  } catch (err: any) {
    console.error("[chat] Delete session error:", err);
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

// POST /api/chat/sessions/:id/messages — send message, get AI response
router.post(
  "/sessions/:id/messages",
  async (req: Request, res: Response) => {
    try {
      const sessionId = Number(req.params.id);
      const { content } = req.body;

      if (!content) {
        return res.status(400).json({ error: "訊息內容不能為空" });
      }

      // Verify session exists
      const session = sqlite
        .prepare("SELECT id FROM chat_sessions WHERE id = ?")
        .get(sessionId);

      if (!session) {
        return res.status(404).json({ error: "對話不存在" });
      }

      // Save user message
      sqlite
        .prepare(
          "INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)"
        )
        .run(sessionId, content);

      // Search FTS5 for relevant context from files and diary
      let contextParts: string[] = [];

      try {
        const fileResults = sqlite
          .prepare(
            `SELECT f.filename, f.ai_summary, snippet(files_fts, 0, '**', '**', '...', 32) as snippet
            FROM files_fts
            JOIN files f ON f.id = files_fts.rowid
            WHERE files_fts MATCH ?
            ORDER BY rank
            LIMIT 3`
          )
          .all(content) as any[];

        for (const r of fileResults) {
          contextParts.push(
            `[檔案: ${r.filename}] ${r.ai_summary || r.snippet}`
          );
        }
      } catch {
        // FTS match might fail on certain queries; ignore
      }

      try {
        const diaryResults = sqlite
          .prepare(
            `SELECT d.title, snippet(diary_fts, 1, '**', '**', '...', 32) as snippet
            FROM diary_fts
            JOIN diary_entries d ON d.id = diary_fts.rowid
            WHERE diary_fts MATCH ?
            ORDER BY rank
            LIMIT 3`
          )
          .all(content) as any[];

        for (const r of diaryResults) {
          contextParts.push(`[日記: ${r.title}] ${r.snippet}`);
        }
      } catch {
        // FTS match might fail; ignore
      }

      const contextStr = contextParts.length > 0
        ? contextParts.join("\n\n")
        : "";

      // Get conversation history
      const history = sqlite
        .prepare(
          "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC"
        )
        .all(sessionId) as Array<{ role: string; content: string }>;

      // Call AI
      let aiResponse: string;
      try {
        aiResponse = await chatWithContext(content, contextStr, history);
      } catch (err) {
        console.error("[chat] AI response failed:", err);
        aiResponse = "抱歉，AI 回應暫時無法使用。請確認 API 金鑰已正確設定。";
      }

      // Save assistant message
      const result = sqlite
        .prepare(
          "INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)"
        )
        .run(sessionId, aiResponse);

      const assistantMessage = sqlite
        .prepare("SELECT * FROM chat_messages WHERE id = ?")
        .get(result.lastInsertRowid);

      res.status(201).json(assistantMessage);
    } catch (err: any) {
      console.error("[chat] Send message error:", err);
      res.status(500).json({ error: err.message || "發送失敗" });
    }
  }
);

// GET /api/chat/sessions/:id/messages — get all messages in session
router.get("/sessions/:id/messages", (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.id);

    const session = sqlite
      .prepare("SELECT id FROM chat_sessions WHERE id = ?")
      .get(sessionId);

    if (!session) {
      return res.status(404).json({ error: "對話不存在" });
    }

    const messages = sqlite
      .prepare(
        "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC"
      )
      .all(sessionId);

    res.json({ messages });
  } catch (err: any) {
    console.error("[chat] Get messages error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

export default router;
