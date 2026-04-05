import { Router, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { sqlite } from "../db/connection.js";
import { AGENTS, AgentPersona } from "../ai/agents.js";
import { callGeminiText } from "../ai/geminiRetry.js";
import { analyzeImage } from "../ai/geminiClient.js";
import { selectAgentsWithAI } from "../ai/diaryAnalyzer.js";
import { IMAGES_DIR } from "./diaryImages.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";

// ── Multer for chat image uploads (disk storage, served as static) ───
const CHAT_IMAGES_DIR = path.join(IMAGES_DIR, "chat");
fs.mkdirSync(CHAT_IMAGES_DIR, { recursive: true });

const chatImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CHAT_IMAGES_DIR),
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${unique}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`不支援的圖片格式: ${file.mimetype}`));
    }
  },
});

const router = Router();

// All chat routes parse auth; user_id=0 for guests
router.use(optionalAuth);

// ── SSE helpers ──────────────────────────────────────────────────────

function sseWrite(res: Response, event: Record<string, any>): void {
  try {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (typeof (res as any).flush === "function") {
        (res as any).flush();
      }
    }
  } catch {
    // Connection closed — ignore
  }
}


// callGeminiText is imported from geminiRetry.ts — single shared implementation
// for all non-streaming Gemini calls across chat and diary modules.

// ── Run a single agent in chat mode ──────────────────────────────────

function buildNicknameInstruction(nickname: string): string {
  return nickname ? `使用者的暱稱是「${nickname}」，請在回應中用暱稱稱呼使用者。\n\n` : '';
}

function buildCustomInstructions(customInstructions: string): string {
  return customInstructions.trim()
    ? `使用者的自訂指示（請遵守）：\n${customInstructions.trim()}\n\n`
    : '';
}

async function runChatAgent(
  agent: AgentPersona,
  userMessage: string,
  contextStr: string,
  historyStr: string,
  _apiKey: string, // ignored — withStreamRetry handles key selection
  onEvent: (event: Record<string, any>) => void,
  imagePart?: string,
  nickname?: string,
  customInstructions?: string,
): Promise<{ agentId: string; result: string }> {
  onEvent({
    type: "agent-start",
    agentId: agent.id,
    agentName: agent.name,
    agentEmoji: agent.emoji,
    agentRole: agent.role,
  });

  const chatSystemPrompt = `${buildNicknameInstruction(nickname || '')}${buildCustomInstructions(customInstructions || '')}你是「${agent.name}」（${agent.role}），正在和其他 AI 好友一起回應使用者的訊息。

${agent.systemPrompt}

【對話模式注意事項】
- 你的回應會被整合到最終回覆中
- 保持簡短（2-3句話）
- 用對話的口吻，不要像報告
- 使用者的文字問題是主要意圖，必須優先回應文字問題
- 如果使用者同時上傳了圖片，圖片只是輔助資訊，不要讓圖片內容蓋過文字問題
- 如果使用者只傳圖片沒有文字，才以圖片內容為主
- 如果有相關資料被提供，引用它`;

  // Text question is the primary intent
  let prompt = `使用者的問題（主要回應目標）：${userMessage}`;
  if (imagePart) prompt += `\n\n【使用者同時上傳了圖片（輔助資訊，不要忽視文字問題）】\n${imagePart}`;
  if (contextStr) prompt += `\n\n【相關資料】\n${contextStr}`;
  if (historyStr) prompt += `\n\n【最近對話紀錄】\n${historyStr}`;

  let fullText = await callGeminiText(chatSystemPrompt, prompt, 1000, { maxRetries: 5, callType: "chat-agent", disableThinking: true });

  // Send the full result as a single "thinking" event
  if (fullText) {
    onEvent({
      type: "agent-thinking",
      agentId: agent.id,
      agentName: agent.name,
      agentEmoji: agent.emoji,
      content: fullText,
    });
  }

  onEvent({
    type: "agent-done",
    agentId: agent.id,
    agentName: agent.name,
    agentEmoji: agent.emoji,
    content: fullText,
  });

  return { agentId: agent.id, result: fullText };
}

// ── Master synthesis for chat ────────────────────────────────────────

const MASTER_CHAT_PROMPT = `你是心靈日記的 AI 助手，正在和使用者對話。多位 AI 好友已經各自分析了使用者的訊息。

請根據他們的分析，以及相關的資料庫搜尋結果，以每位好友的身份分別回覆。

規則：
- 繁體中文
- 每位好友各自用自己的口吻回應 1-3 句話
- 保持每位好友的個性和風格
- 如果有參考到使用者的日記或檔案，自然提及
- 輸出格式必須是：

{emoji} {名字}：[用該好友的口吻回應]

{emoji} {名字}：[用該好友的口吻回應]

（每位好友之間空一行）`;

async function synthesizeChat(
  agentResults: Array<{ agentId: string; result: string }>,
  userMessage: string,
  contextStr: string,
  historyStr: string,
  onEvent: (event: Record<string, any>) => void,
  imagePart?: string,
  nickname?: string,
): Promise<string> {
  onEvent({ type: "synthesizing", message: "🧠 整合回覆中..." });

  const analysisBlock = agentResults
    .map((r) => {
      const agent = AGENTS[r.agentId];
      return `【${agent.emoji} ${agent.name}（${agent.role}）的觀點】\n${r.result}`;
    })
    .join("\n\n");

  const agentFormatHint = agentResults
    .map((r) => {
      const agent = AGENTS[r.agentId];
      return `${agent.emoji} ${agent.name}`;
    })
    .join("、");

  let prompt = `使用者的問題（主要回應目標）：${userMessage}\n\n`;
  if (imagePart) prompt += `【使用者同時上傳了圖片（輔助資訊）】\n${imagePart}\n\n`;
  if (contextStr) prompt += `【相關資料】\n${contextStr}\n\n`;
  if (historyStr) prompt += `【最近對話紀錄】\n${historyStr}\n\n`;
  prompt += `以下是各位好友的觀點：\n\n${analysisBlock}`;
  prompt += `\n\n請以這些好友的身份回覆（${agentFormatHint}），每位 1-3 句話，確保回應使用者的文字問題。`;

  const fullText = await callGeminiText(buildNicknameInstruction(nickname || '') + MASTER_CHAT_PROMPT, prompt, 4096, { maxRetries: 5, callType: "chat-master", disableThinking: true, timeoutMs: 30000 });
  onEvent({ type: "synthesizing", content: fullText });
  return fullText;
}

// ── Chat Folders CRUD ────────────────────────────────────────────────

// GET /api/chat/folders
router.get("/folders", (_req: Request, res: Response) => {
  try {
    const folders = sqlite.prepare("SELECT * FROM chat_folders ORDER BY sort_order ASC, created_at ASC").all();
    res.json({ folders });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// POST /api/chat/folders
router.post("/folders", requireAuth, (req: Request, res: Response) => {
  try {
    const { name, icon } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "名稱不能為空" });
    const result = sqlite.prepare("INSERT INTO chat_folders (name, icon) VALUES (?, ?)").run(name.trim(), icon || '💬');
    const folder = sqlite.prepare("SELECT * FROM chat_folders WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(folder);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "建立失敗" });
  }
});

// PUT /api/chat/folders/:id
router.put("/folders/:id", requireAuth, (req: Request, res: Response) => {
  try {
    const { name, icon } = req.body;
    const id = Number(req.params.id);
    sqlite.prepare("UPDATE chat_folders SET name = COALESCE(?, name), icon = COALESCE(?, icon) WHERE id = ?").run(name || null, icon || null, id);
    const folder = sqlite.prepare("SELECT * FROM chat_folders WHERE id = ?").get(id);
    res.json(folder);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "更新失敗" });
  }
});

// DELETE /api/chat/folders/:id
router.delete("/folders/:id", requireAuth, (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    sqlite.prepare("UPDATE chat_sessions SET folder_id = NULL WHERE folder_id = ?").run(id);
    sqlite.prepare("DELETE FROM chat_folders WHERE id = ?").run(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

// ── Sessions CRUD ────────────────────────────────────────────────────

// POST /api/chat/sessions — create new session
router.post("/sessions", (req: Request, res: Response) => {
  try {
    const title = req.body.title || "新對話";
    const folderId = req.body.folder_id || null;
    const result = sqlite
      .prepare("INSERT INTO chat_sessions (title, folder_id, user_id) VALUES (?, ?, ?)")
      .run(title, folderId, req.userId);

    const session = sqlite
      .prepare("SELECT * FROM chat_sessions WHERE id = ?")
      .get(result.lastInsertRowid);

    res.status(201).json(session);
  } catch (err: any) {
    console.error("[chat] Create session error:", err);
    res.status(500).json({ error: err.message || "建立失敗" });
  }
});

// PUT /api/chat/sessions/:id — update session (title, folder)
router.put("/sessions/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { title, folder_id } = req.body;
    sqlite.prepare("UPDATE chat_sessions SET title = COALESCE(?, title), folder_id = ? WHERE id = ? AND user_id = ?")
      .run(title || null, folder_id !== undefined ? folder_id : null, id, req.userId);
    const session = sqlite.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "更新失敗" });
  }
});

// GET /api/chat/sessions — list sessions with last message preview
router.get("/sessions", (req: Request, res: Response) => {
  try {
    const folderId = req.query.folder_id;
    let query = `SELECT s.*,
          (SELECT content FROM chat_messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count
        FROM chat_sessions s
        WHERE s.user_id = ?`;
    const params: any[] = [req.userId];

    if (folderId === 'null') {
      query += " AND s.folder_id IS NULL";
    } else if (folderId) {
      query += " AND s.folder_id = ?";
      params.push(Number(folderId));
    }

    query += " ORDER BY s.created_at DESC";
    const sessions = sqlite.prepare(query).all(...params);

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
      .prepare("SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?")
      .get(id, req.userId);

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

// ── POST /api/chat/sessions/:id/messages — SSE streaming multi-agent ─

router.post(
  "/sessions/:id/messages",
  chatImageUpload.single("image"),
  async (req: Request, res: Response) => {
    const sessionId = Number(req.params.id);
    const content = req.body.content || '';

    if (!content && !req.file) {
      return res.status(400).json({ error: "訊息內容不能為空" });
    }

    // Verify session exists and belongs to current user
    const session = sqlite
      .prepare("SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?")
      .get(sessionId, req.userId) as { id: number; title: string } | undefined;

    if (!session) {
      return res.status(404).json({ error: "對話不存在" });
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    if ((res as any).socket) (res as any).socket.setNoDelay(true);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
      if (typeof (res as any).flush === "function") {
        (res as any).flush();
      }
    }, 15000);

    // Handle client disconnect — use res.on('close') not req.on('close'):
    // req 'close' fires when the request body is consumed (immediately after POST body is read),
    // whereas res 'close' fires only when the actual TCP connection drops.
    let aborted = false;
    res.on("close", () => {
      aborted = true;
      clearInterval(heartbeat);
    });

    const sendEvent = (event: Record<string, any>) => {
      if (!aborted) sseWrite(res, event);
    };

    try {
      // 1. Save user message (with image_url if uploaded)
      const imageUrl = req.file
        ? `/images/chat/${path.basename(req.file.path)}`
        : null;

      sqlite
        .prepare(
          "INSERT INTO chat_messages (session_id, role, content, image_url) VALUES (?, 'user', ?, ?)"
        )
        .run(sessionId, content, imageUrl);

      // Check if this is the first message — title will be generated after AI responds
      const msgCount = (
        sqlite
          .prepare(
            "SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?"
          )
          .get(sessionId) as { count: number }
      ).count;
      const isFirstMessage = msgCount === 1;

      // 2. Search FTS5 for relevant context
      sendEvent({ type: "phase", phase: "searching", message: "搜尋相關資料..." });

      let imagePart = ""; // image analysis stored separately to preserve intent priority
      let contextParts: string[] = [];

      try {
        const fileResults = sqlite
          .prepare(
            `SELECT f.filename, f.ai_summary, snippet(files_fts, 0, '**', '**', '...', 32) as snippet
            FROM files_fts
            JOIN files f ON f.id = files_fts.rowid
            WHERE files_fts MATCH ? AND f.user_id = ?
            ORDER BY rank
            LIMIT 3`
          )
          .all(content, req.userId) as any[];

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
            WHERE diary_fts MATCH ? AND d.user_id = ?
            ORDER BY rank
            LIMIT 3`
          )
          .all(content, req.userId) as any[];

        for (const r of diaryResults) {
          contextParts.push(`[日記: ${r.title}] ${r.snippet}`);
        }
      } catch {
        // FTS match might fail; ignore
      }

      // Analyze uploaded image (if any) — kept separate so text question stays primary intent
      if (req.file) {
        sendEvent({ type: "phase", phase: "analyzing-image", message: "分析圖片中..." });
        try {
          const imgBuffer = fs.readFileSync(req.file.path);
          const imgTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("image analysis timeout")), 60000)
          );
          const imgResult = await Promise.race([
            analyzeImage(
              imgBuffer,
              req.file.mimetype,
              "請詳細描述這張圖片的內容，包括主要元素、色彩、文字、情境等所有細節。"
            ),
            imgTimeout,
          ]);
          imagePart = imgResult.text;
        } catch (imgErr) {
          console.error("[chat] Image analysis failed:", imgErr);
          imagePart = "（圖片分析失敗）";
        }
      }

      const contextStr =
        contextParts.length > 0 ? contextParts.join("\n\n") : "";

      // 3. Get conversation history (last 5 messages for context)
      const history = sqlite
        .prepare(
          "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 10"
        )
        .all(sessionId) as Array<{ role: string; content: string }>;

      // Reverse to chronological order and format
      const historyStr = history
        .reverse()
        .slice(0, -1) // exclude the just-inserted user message (it's the prompt)
        .map((m) => `${m.role === "user" ? "使用者" : "助手"}：${m.content}`)
        .join("\n");

      // 4. AI-based agent selection with reasoning
      sendEvent({ type: "phase", phase: "analyzing", message: "AI 分析訊息，選擇最適合的好友..." });

      // Build agent selection input — text question is primary intent, image is auxiliary
      let selectionInput = `使用者的問題（主要意圖）：${content}`;
      if (imagePart) selectionInput += `\n\n【使用者同時上傳了圖片（輔助資訊）】\n${imagePart}`;
      if (contextStr) selectionInput += `\n\n相關背景資料：\n${contextStr}`;

      const { selections, summary: selectionSummary } = await selectAgentsWithAI(selectionInput, 3);

      // Build intent data from AI selections
      const reasonsMap: Record<string, string> = {};
      for (const s of selections) {
        reasonsMap[s.agent.id] = s.reason;
      }

      sendEvent({
        type: "intent",
        agents: selections.map((s) => ({
          id: s.agent.id,
          name: s.agent.name,
          emoji: s.agent.emoji,
          role: s.agent.role,
          reason: s.reason,
        })),
        reasons: reasonsMap,
        summary: selectionSummary,
      });

      const selectedAgents = selections.map((s) => s.agent);
      const intentResult = {
        agents: selections.map((s) => ({ id: s.agent.id, reason: s.reason })),
        summary: selectionSummary,
      };

      sendEvent({
        type: "phase",
        phase: "thinking",
        message: `派出 ${selectedAgents.length} 位好友討論`,
        agents: selectedAgents.map((a) => ({
          id: a.id,
          name: a.name,
          emoji: a.emoji,
          role: a.role,
        })),
      });

      // Look up user nickname and custom_instructions for personalized AI responses
      const chatUserData = sqlite.prepare("SELECT nickname, custom_instructions FROM users WHERE id = ?").get(req.userId) as { nickname: string; custom_instructions: string } | undefined;
      const userNickname = chatUserData?.nickname || '';
      const userCustomInstructions = chatUserData?.custom_instructions || '';

      // 5. Run agents in parallel (callGeminiWithRetry handles keys internally)
      const agentPromises = selectedAgents.map((agent) => {
        return runChatAgent(
          agent,
          content,
          contextStr,
          historyStr,
          "",
          sendEvent,
          imagePart || undefined,
          userNickname,
          userCustomInstructions,
        ).catch((err) => {
          console.error(`[chat] Agent ${agent.id} failed:`, err);
          sendEvent({
            type: "agent-done",
            agentId: agent.id,
            agentName: agent.name,
            agentEmoji: agent.emoji,
            content: "（暫時無法回應）",
          });
          return { agentId: agent.id, result: "（暫時無法回應）" };
        });
      });

      const agentResults = await Promise.all(agentPromises);

      // Always continue to synthesis + save, even if client disconnected
      // (so the response is stored in DB for next page load)
      sendEvent({
        type: "phase",
        phase: "synthesizing",
        message: "整合回覆中...",
      });

      const aiResponse = await synthesizeChat(
        agentResults,
        content,
        contextStr,
        historyStr,
        sendEvent,
        imagePart || undefined,
        userNickname,
      );

      // 6.5 Generate AI title from full conversation context (first message only)
      // IMPORTANT: must be awaited BEFORE complete event + res.end(), otherwise
      // the SSE stream closes before the title-updated event can be delivered.
      if (isFirstMessage) {
        try {
          const titleContext = `使用者：${content.slice(0, 300)}\n\nAI 回覆：${aiResponse.slice(0, 500)}`;
          console.log('[chat-title] Generating title for session', sessionId);
          const aiTitle = await callGeminiText(
            '你是標題生成助手。根據對話內容，生成一個簡短的繁體中文標題（10字以內，不要加引號或標點）。標題要反映對話的實質內容（例如：討論的主題、物品、事件），不要直接照抄使用者的原話。只回傳標題本身。',
            titleContext,
            2048,
            { maxRetries: 2, callType: 'chat-title', disableThinking: true },
          );
          const cleanTitle = aiTitle.trim().replace(/^[「『"']+|[」』"']+$/g, '').trim().slice(0, 30);
          console.log('[chat-title] Generated:', JSON.stringify(cleanTitle), '| raw length:', aiTitle.length);
          if (cleanTitle) {
            sqlite.prepare("UPDATE chat_sessions SET title = ? WHERE id = ?").run(cleanTitle, sessionId);
            sendEvent({ type: 'title-updated', sessionId, title: cleanTitle });
          } else {
            console.warn('[chat-title] Empty title after cleaning, falling back');
            throw new Error('empty title');
          }
        } catch (titleErr) {
          // Fallback: use truncated user content
          console.error('[chat-title] Title generation failed, using fallback:', (titleErr as Error).message);
          const fallback = content.slice(0, 20) + (content.length > 20 ? '...' : '');
          sqlite.prepare("UPDATE chat_sessions SET title = ? WHERE id = ?").run(fallback, sessionId);
          sendEvent({ type: 'title-updated', sessionId, title: fallback });
        }
      }

      // 7. Save assistant message with ai_agents and dispatch_reason
      // Include agent text so thinking can be reconstructed on reload
      const agentTextMap: Record<string, string> = {};
      for (const r of agentResults) agentTextMap[r.agentId] = r.result;

      const aiAgentsJson = JSON.stringify(
        intentResult.agents.map((a) => {
          const agent = AGENTS[a.id];
          return {
            id: a.id,
            name: agent?.name || a.id,
            emoji: agent?.emoji || "🤖",
            role: agent?.role || "",
            reason: a.reason,
            text: agentTextMap[a.id] || "",
          };
        })
      );
      const dispatchReason = intentResult.summary;

      const result = sqlite
        .prepare(
          "INSERT INTO chat_messages (session_id, role, content, ai_agents, dispatch_reason) VALUES (?, 'assistant', ?, ?, ?)"
        )
        .run(sessionId, aiResponse, aiAgentsJson, dispatchReason);

      const assistantMessage = sqlite
        .prepare("SELECT * FROM chat_messages WHERE id = ?")
        .get(result.lastInsertRowid) as {
        id: number;
        role: string;
        content: string;
        ai_agents: string | null;
        dispatch_reason: string | null;
        created_at: string;
      };

      // 8. Also fetch the saved user message to get its DB id (replaces temp)
      const userMessage = sqlite
        .prepare(
          "SELECT id, role, content, image_url, created_at FROM chat_messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1"
        )
        .get(sessionId) as { id: number; role: string; content: string; image_url: string | null; created_at: string } | undefined;

      // 9. Stream complete event
      sendEvent({
        type: "complete",
        userMessage: userMessage
          ? { id: userMessage.id, role: userMessage.role, content: userMessage.content, image_url: userMessage.image_url, created_at: userMessage.created_at }
          : undefined,
        message: {
          id: assistantMessage.id,
          role: assistantMessage.role,
          content: assistantMessage.content,
          ai_agents: assistantMessage.ai_agents,
          dispatch_reason: assistantMessage.dispatch_reason,
          created_at: assistantMessage.created_at,
        },
      });
    } catch (err: any) {
      console.error("[chat] SSE message error:", err);
      sendEvent({
        type: "error",
        message: err.message || "處理訊息時發生錯誤",
      });
    } finally {
      clearInterval(heartbeat);
      if (!aborted) res.end();
    }
  }
);

// GET /api/chat/sessions/:id/messages — get all messages in session
router.get("/sessions/:id/messages", (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.id);

    const session = sqlite
      .prepare("SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?")
      .get(sessionId, req.userId);

    if (!session) {
      return res.status(404).json({ error: "對話不存在" });
    }

    const messages = sqlite
      .prepare(
        "SELECT id, session_id, role, content, image_url, ai_agents, dispatch_reason, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC"
      )
      .all(sessionId);

    res.json({ messages });
  } catch (err: any) {
    console.error("[chat] Get messages error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

export default router;
