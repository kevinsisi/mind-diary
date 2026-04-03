import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../api/client';
import {
  Plus,
  Trash2,
  Send,
  MessageCircle,
  Loader2,
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────

interface Session {
  id: number;
  title: string;
  created_at: string;
  lastMessage?: string;
}

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// ── Component ─────────────────────────────────────────────────────

export default function Chat() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Load sessions ───────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    try {
      const data = await apiClient.get<Session[] | { sessions: Session[] }>(
        '/api/chat/sessions',
      );
      const list = Array.isArray(data) ? data : data?.sessions || [];
      setSessions(list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // ── Load messages for active session ────────────────────────────

  const loadMessages = useCallback(async (sessionId: number) => {
    setLoading(true);
    try {
      const data = await apiClient.get<Message[] | { messages: Message[] }>(
        `/api/chat/sessions/${sessionId}/messages`,
      );
      const list = Array.isArray(data) ? data : data?.messages || [];
      setMessages(list);
    } catch (err) {
      console.error('Failed to load messages:', err);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSessionId) {
      loadMessages(activeSessionId);
    } else {
      setMessages([]);
    }
  }, [activeSessionId, loadMessages]);

  // ── Auto-scroll ─────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Create new session ──────────────────────────────────────────

  const createSession = async () => {
    try {
      const session = await apiClient.post<Session>('/api/chat/sessions');
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
      inputRef.current?.focus();
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  // ── Delete session ──────────────────────────────────────────────

  const deleteSession = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('確定要刪除這個對話嗎？')) return;
    try {
      await apiClient.delete(`/api/chat/sessions/${id}`);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  // ── Send message ────────────────────────────────────────────────

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || sendingMessage) return;

    let sessionId = activeSessionId;

    // Auto-create session if none selected
    if (!sessionId) {
      try {
        const session = await apiClient.post<Session>('/api/chat/sessions');
        setSessions((prev) => [session, ...prev]);
        setActiveSessionId(session.id);
        sessionId = session.id;
      } catch (err) {
        console.error('Failed to create session:', err);
        return;
      }
    }

    setInput('');
    setSendingMessage(true);

    // Optimistic: add user message immediately
    const tempUserMsg: Message = {
      id: Date.now(),
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const data = await apiClient.post<{
        userMessage: Message;
        assistantMessage: Message;
      }>(`/api/chat/sessions/${sessionId}/messages`, { content });

      // Replace temp message with real ones
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempUserMsg.id);
        return [...withoutTemp, data.userMessage, data.assistantMessage];
      });

      // Refresh sessions to update title/lastMessage
      loadSessions();
    } catch (err) {
      console.error('Failed to send message:', err);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setInput(content); // restore input
    } finally {
      setSendingMessage(false);
      inputRef.current?.focus();
    }
  };

  // ── Key handler for textarea ────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Render helpers ──────────────────────────────────────────────

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' });
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="-m-6 flex h-[calc(100vh-4rem)] lg:h-screen">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'w-72' : 'w-0'
        } flex-shrink-0 transition-all duration-200 overflow-hidden border-r border-gray-200 bg-gray-50`}
      >
        <div className="w-72 h-full flex flex-col">
          {/* Sidebar header */}
          <div className="flex items-center justify-between p-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700">對話紀錄</h2>
            <button
              onClick={createSession}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Plus size={14} />
              新增對話
            </button>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 && (
              <p className="text-center text-sm text-gray-400 mt-8">
                尚無對話紀錄
              </p>
            )}
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setActiveSessionId(session.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors group flex items-center justify-between gap-2 ${
                  activeSessionId === session.id
                    ? 'bg-indigo-100 text-indigo-800'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {session.title || '新對話'}
                  </div>
                  {session.lastMessage && (
                    <div className="text-xs text-gray-400 truncate mt-0.5">
                      {session.lastMessage}
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-0.5">
                    {formatTime(session.created_at)}
                  </div>
                </div>
                <button
                  onClick={(e) => deleteSession(session.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-all flex-shrink-0"
                  title="刪除對話"
                >
                  <Trash2 size={14} />
                </button>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
            title={sidebarOpen ? '收起側欄' : '展開側欄'}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <h2 className="text-sm font-semibold text-gray-700">
            {activeSessionId
              ? sessions.find((s) => s.id === activeSessionId)?.title || '對話'
              : 'AI 對話'}
          </h2>
        </div>

        {/* Messages or empty state */}
        {!activeSessionId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <MessageCircle size={48} strokeWidth={1.5} />
            <p className="mt-4 text-lg">選擇或建立一個對話</p>
            <button
              onClick={createSession}
              className="mt-4 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              開始新對話
            </button>
          </div>
        ) : (
          <>
            {/* Messages list */}
            <div className="flex-1 overflow-y-auto px-4 py-6">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 size={24} className="animate-spin text-indigo-500" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <MessageCircle size={36} strokeWidth={1.5} />
                  <p className="mt-3 text-sm">開始你的對話吧</p>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto space-y-4">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-indigo-600 text-white rounded-br-md'
                            : 'bg-gray-100 text-gray-800 rounded-bl-md'
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                        <div
                          className={`text-xs mt-1.5 ${
                            msg.role === 'user' ? 'text-indigo-200' : 'text-gray-400'
                          }`}
                        >
                          {formatTime(msg.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {sendingMessage && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Loader2 size={14} className="animate-spin text-gray-400" />
                          <span className="text-sm text-gray-400">AI 思考中...</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input bar */}
            <div className="border-t border-gray-200 bg-white px-4 py-3">
              <div className="max-w-3xl mx-auto flex items-end gap-3">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="輸入訊息... (Enter 發送, Shift+Enter 換行)"
                  rows={1}
                  className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent max-h-32 overflow-y-auto"
                  style={{
                    height: 'auto',
                    minHeight: '2.75rem',
                  }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = 'auto';
                    target.style.height = Math.min(target.scrollHeight, 128) + 'px';
                  }}
                  disabled={sendingMessage}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || sendingMessage}
                  className="flex-shrink-0 p-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="發送訊息"
                >
                  {sendingMessage ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
