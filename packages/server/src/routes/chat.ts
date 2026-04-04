import { Router, Request, Response } from "express";
import { sqlite } from "../db/connection.js";
import { AGENTS } from "../ai/agents.js";
import { assignBatchKeys, trackUsageByKey } from "../ai/keyPool.js";
import { selectAgents } from "../ai/diaryAnalyzer.js";
import { IntentResult } from "../ai/intentAnalyzer.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = Router();

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


// ── Gemini call with key rotation + 15s timeout ─────────────────────

async function callGeminiWithRetry(
  systemPrompt: string,
  prompt: string,
  maxTokens: number,
  maxAttempts: number = 3,
): Promise<string> {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const keys = assignBatchKeys(maxAttempts);
  let lastError: unknown;

  for (let i = 0; i < Math.min(maxAttempts, keys.length); i++) {
    const apiKey = keys[i];
    try {
      const genai = new GoogleGenerativeAI(apiKey);
      const model = genai.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
        generationConfig: { maxOutputTokens: maxTokens },
      });

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 15000)
      );
      const response = await Promise.race([
        model.generateContent(prompt),
        timeout,
      ]);
      const text = response.response.text();

      const usage = response.response.usageMetadata;
      if (usage) {
        trackUsageByKey(apiKey, modelName, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, "chat");
      }
      return text;
    } catch (err: any) {
      lastError = err;
      const msg = err?.message || "";
      // Block suspended keys permanently
      if (msg.includes("suspended")) {
        const { markKeyBad } = await import("../ai/keyPool.js");
        markKeyBad(apiKey, "403 suspended");
      }
      // Continue to next key for 429/timeout/suspended
      if (msg.includes("429") || msg.includes("timeout") || msg.includes("suspended") || msg.includes("403")) {
        continue;
      }
      throw err; // Unknown errors — don't retry
    }
  }
  throw lastError || new Error("All keys exhausted");
}

// ── Run a single agent in chat mode ──────────────────────────────────

async function runChatAgent(
  agent: AgentPersona,
  userMessage: string,
  contextStr: string,
  historyStr: string,
  _apiKey: string, // ignored — withStreamRetry handles key selection
  onEvent: (event: Record<string, any>) => void
): Promise<{ agentId: string; result: string }> {
  onEvent({
    type: "agent-start",
    agentId: agent.id,
    agentName: agent.name,
    agentEmoji: agent.emoji,
    agentRole: agent.role,
  });

  const chatSystemPrompt = `你是「${agent.name}」（${agent.role}），正在和其他 AI 好友一起回應使用者的訊息。

${agent.systemPrompt}

【對話模式注意事項】
- 你的回應會被整合到最終回覆中
- 保持簡短（2-3句話）
- 用對話的口吻，不要像報告
- 如果有相關資料被提供，引用它`;

  let prompt = `使用者訊息：${userMessage}`;
  if (contextStr) prompt += `\n\n【相關資料】\n${contextStr}`;
  if (historyStr) prompt += `\n\n【最近對話紀錄】\n${historyStr}`;

  let fullText = await callGeminiWithRetry(chatSystemPrompt, prompt, 300, 5);

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

  const usage = response.response.usageMetadata;
  if (usage) {
    trackUsageByKey(apiKey, modelName, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, "chat-agent");
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

  let prompt = `使用者訊息：${userMessage}\n\n`;
  if (contextStr) prompt += `【相關資料】\n${contextStr}\n\n`;
  if (historyStr) prompt += `【最近對話紀錄】\n${historyStr}\n\n`;
  prompt += `以下是各位好友的觀點：\n\n${analysisBlock}`;
  prompt += `\n\n請以這些好友的身份回覆（${agentFormatHint}），每位 1-3 句話。`;

  const fullText = await callGeminiWithRetry(MASTER_CHAT_PROMPT, prompt, 1024, 5);
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
router.post("/folders", (req: Request, res: Response) => {
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
router.put("/folders/:id", (req: Request, res: Response) => {
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
router.delete("/folders/:id", (req: Request, res: Response) => {
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
      .prepare("INSERT INTO chat_sessions (title, folder_id) VALUES (?, ?)")
      .run(title, folderId);

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
    sqlite.prepare("UPDATE chat_sessions SET title = COALESCE(?, title), folder_id = ? WHERE id = ?")
      .run(title || null, folder_id !== undefined ? folder_id : null, id);
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
        FROM chat_sessions s`;
    const params: any[] = [];

    if (folderId === 'null') {
      query += " WHERE s.folder_id IS NULL";
    } else if (folderId) {
      query += " WHERE s.folder_id = ?";
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

// ── POST /api/chat/sessions/:id/messages — SSE streaming multi-agent ─

router.post(
  "/sessions/:id/messages",
  async (req: Request, res: Response) => {
    const sessionId = Number(req.params.id);
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: "訊息內容不能為空" });
    }

    // Verify session exists
    const session = sqlite
      .prepare("SELECT * FROM chat_sessions WHERE id = ?")
      .get(sessionId) as { id: number; title: string } | undefined;

    if (!session) {
      return res.status(404).json({ error: "對話不存在" });
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
      if (typeof (res as any).flush === "function") {
        (res as any).flush();
      }
    }, 15000);

    // Handle client disconnect
    let aborted = false;
    req.on("close", () => {
      aborted = true;
      clearInterval(heartbeat);
    });

    const sendEvent = (event: Record<string, any>) => {
      if (!aborted) sseWrite(res, event);
    };

    try {
      // 1. Save user message
      sqlite
        .prepare(
          "INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)"
        )
        .run(sessionId, content);

      // Update session title to first message content (truncated) if it's the first message
      const msgCount = (
        sqlite
          .prepare(
            "SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?"
          )
          .get(sessionId) as { count: number }
      ).count;

      if (msgCount === 1) {
        const truncatedTitle = content.slice(0, 20) + (content.length > 20 ? "..." : "");
        sqlite
          .prepare("UPDATE chat_sessions SET title = ? WHERE id = ?")
          .run(truncatedTitle, sessionId);
      }

      // 2. Search FTS5 for relevant context
      sendEvent({ type: "phase", phase: "searching", message: "搜尋相關資料..." });

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

      // 4. Select agents via keyword matching (instant, no API call)
      sendEvent({ type: "phase", phase: "analyzing", message: "分析意圖中..." });

      const keywordAgents = selectAgents(`${content} ${contextStr}`, 3);
      const intentResult: IntentResult = {
        agents: keywordAgents.map((a) => ({
          id: a.id,
          reason: `與${a.role}相關`,
        })),
        summary: `根據你的訊息，我請了${keywordAgents.map((a) => a.name).join("和")}來聊聊`,
      };

      // Build reasons map for the intent event
      const reasonsMap: Record<string, string> = {};
      for (const a of intentResult.agents) {
        reasonsMap[a.id] = a.reason;
      }

      sendEvent({
        type: "intent",
        agents: intentResult.agents.map((a) => {
          const agent = AGENTS[a.id];
          return {
            id: a.id,
            name: agent?.name || a.id,
            emoji: agent?.emoji || "🤖",
            role: agent?.role || "",
            reason: a.reason,
          };
        }),
        reasons: reasonsMap,
        summary: intentResult.summary,
      });

      const selectedAgents = intentResult.agents
        .map((a) => AGENTS[a.id])
        .filter((a): a is AgentPersona => !!a);

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

      // 5. Run agents in parallel (callGeminiWithRetry handles keys internally)
      const agentPromises = selectedAgents.map((agent) => {
        return runChatAgent(
          agent,
          content,
          contextStr,
          historyStr,
          "",
          sendEvent
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
      );

      // 7. Save assistant message with ai_agents and dispatch_reason
      const aiAgentsJson = JSON.stringify(
        intentResult.agents.map((a) => {
          const agent = AGENTS[a.id];
          return {
            id: a.id,
            name: agent?.name || a.id,
            emoji: agent?.emoji || "🤖",
            role: agent?.role || "",
            reason: a.reason,
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

      // 8. Stream complete event
      sendEvent({
        type: "complete",
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
      .prepare("SELECT id FROM chat_sessions WHERE id = ?")
      .get(sessionId);

    if (!session) {
      return res.status(404).json({ error: "對話不存在" });
    }

    const messages = sqlite
      .prepare(
        "SELECT id, session_id, role, content, ai_agents, dispatch_reason, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC"
      )
      .all(sessionId);

    res.json({ messages });
  } catch (err: any) {
    console.error("[chat] Get messages error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

export default router;
