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
  ChevronDown,
  ChevronRight,
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

interface AgentThinkingState {
  name: string;
  emoji: string;
  role: string;
  text: string;
  done: boolean;
}

interface ThinkingData {
  agents: Record<string, AgentThinkingState>;
  synthesisText: string;
  phase: string;
  collapsed: boolean;
}

interface ChatSSEEvent {
  type: 'phase' | 'agent-start' | 'agent-thinking' | 'agent-done' | 'synthesizing' | 'complete' | 'error';
  phase?: string;
  message?: string | { id: number; role: string; content: string; created_at: string };
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  agentRole?: string;
  content?: string;
  agents?: Array<{ id: string; name: string; emoji: string; role: string }>;
}

// ── ThinkingCard Component ────────────────────────────────────────

function ThinkingCard({
  thinking,
  isStreaming,
  onToggle,
}: {
  thinking: ThinkingData;
  isStreaming: boolean;
  onToggle: () => void;
}) {
  const agentEntries = Object.entries(thinking.agents);
  const agentCount = agentEntries.length;

  if (agentCount === 0 && !isStreaming) return null;

  // Collapsed view
  if (thinking.collapsed && !isStreaming) {
    return (
      <div className="flex justify-start my-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-indigo-600 bg-gray-50 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 rounded-lg transition-colors"
        >
          <ChevronRight size={14} />
          <span>
            {agentCount > 0
              ? `查看 ${agentCount} 位好友的討論`
              : '查看思考過程'}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex justify-start my-2">
      <div className="max-w-[85%] w-full">
        <div className="rounded-xl border border-gray-200 bg-gray-50/80 overflow-hidden">
          {/* Phase indicator */}
          {thinking.phase && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
              {isStreaming && <Loader2 size={12} className="animate-spin text-indigo-500" />}
              <span className="text-xs text-indigo-600 font-medium">{thinking.phase}</span>
            </div>
          )}

          {/* Agent cards */}
          <div className="p-2 space-y-1.5">
            {agentEntries.map(([id, agent]) => (
              <div key={id} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                  <span>{agent.emoji}</span>
                  <span className="text-xs font-medium text-gray-900">{agent.name}</span>
                  <span className="text-xs text-gray-400">{agent.role}</span>
                  {!agent.done && isStreaming && (
                    <Loader2 size={12} className="animate-spin text-indigo-400 ml-auto" />
                  )}
                  {agent.done && <span className="text-xs text-green-500 ml-auto">&#10003;</span>}
                </div>
                <div className="px-3 py-1.5 text-xs text-gray-600 leading-relaxed whitespace-pre-line max-h-24 overflow-y-auto">
                  {agent.text || <span className="text-gray-300 italic">思考中...</span>}
                </div>
              </div>
            ))}

            {/* Synthesis streaming */}
            {thinking.synthesisText && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-100/50 border-b border-indigo-200">
                  <span>&#129504;</span>
                  <span className="text-xs font-medium text-indigo-900">整合者</span>
                  <span className="text-xs text-indigo-400">彙整觀點</span>
                  {isStreaming && (
                    <Loader2 size={12} className="animate-spin text-indigo-400 ml-auto" />
                  )}
                </div>
                <div className="px-3 py-1.5 text-xs text-indigo-800 leading-relaxed whitespace-pre-line max-h-24 overflow-y-auto">
                  {thinking.synthesisText}
                </div>
              </div>
            )}
          </div>

          {/* Collapse button */}
          {!isStreaming && agentCount > 0 && (
            <button
              onClick={onToggle}
              className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border-t border-gray-100 hover:bg-gray-100 transition-colors"
            >
              <ChevronDown size={14} />
              收起思考過程
            </button>
          )}
        </div>
      </div>
    </div>
  );
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

  // Thinking state for current streaming message
  const [currentThinking, setCurrentThinking] = useState<ThinkingData | null>(null);
  // Stored thinking data keyed by the assistant message id that follows it
  const [messageThinking, setMessageThinking] = useState<Record<number, ThinkingData>>({});

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
      // Clear thinking data when switching sessions
      setMessageThinking({});
      setCurrentThinking(null);
    } else {
      setMessages([]);
    }
  }, [activeSessionId, loadMessages]);

  // ── Auto-scroll ─────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentThinking]);

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

  // ── Send message (SSE streaming) ────────────────────────────────

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

    // Initialize thinking state
    const thinking: ThinkingData = {
      agents: {},
      synthesisText: '',
      phase: '',
      collapsed: false,
    };
    setCurrentThinking(thinking);

    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event: ChatSSEEvent = JSON.parse(line.slice(6));

            if (event.type === 'phase') {
              setCurrentThinking((prev) => {
                if (!prev) return prev;
                return { ...prev, phase: (typeof event.message === 'string' ? event.message : event.phase) || '' };
              });
            } else if (event.type === 'agent-start' && event.agentId) {
              setCurrentThinking((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  agents: {
                    ...prev.agents,
                    [event.agentId!]: {
                      name: event.agentName || '',
                      emoji: event.agentEmoji || '',
                      role: event.agentRole || '',
                      text: '',
                      done: false,
                    },
                  },
                };
              });
            } else if (event.type === 'agent-thinking' && event.agentId) {
              setCurrentThinking((prev) => {
                if (!prev) return prev;
                const existing = prev.agents[event.agentId!];
                return {
                  ...prev,
                  agents: {
                    ...prev.agents,
                    [event.agentId!]: {
                      ...existing,
                      text: (existing?.text || '') + (event.content || ''),
                    },
                  },
                };
              });
            } else if (event.type === 'agent-done' && event.agentId) {
              setCurrentThinking((prev) => {
                if (!prev) return prev;
                const existing = prev.agents[event.agentId!];
                return {
                  ...prev,
                  agents: {
                    ...prev.agents,
                    [event.agentId!]: { ...existing, done: true },
                  },
                };
              });
            } else if (event.type === 'synthesizing' && event.content) {
              setCurrentThinking((prev) => {
                if (!prev) return prev;
                return { ...prev, synthesisText: prev.synthesisText + event.content };
              });
            } else if (event.type === 'complete') {
              // Extract the assistant message from the event
              const msg = event.message;
              if (msg && typeof msg === 'object' && 'id' in msg) {
                const assistantMsg: Message = {
                  id: msg.id,
                  role: msg.role as 'assistant',
                  content: msg.content,
                  created_at: msg.created_at,
                };

                // Replace temp user message with real user message if available,
                // and add assistant message
                setMessages((prev) => {
                  // Keep existing messages (including temp user msg) and add assistant
                  return [...prev, assistantMsg];
                });

                // Store thinking data for this assistant message, auto-collapsed
                setCurrentThinking((prev) => {
                  if (prev && Object.keys(prev.agents).length > 0) {
                    setMessageThinking((mt) => ({
                      ...mt,
                      [assistantMsg.id]: { ...prev, collapsed: true },
                    }));
                  }
                  return null;
                });
              } else {
                // Fallback: message might be a string content
                const fallbackMsg: Message = {
                  id: Date.now() + 1,
                  role: 'assistant',
                  content: typeof msg === 'string' ? msg : (event.content || ''),
                  created_at: new Date().toISOString(),
                };
                setMessages((prev) => [...prev, fallbackMsg]);

                setCurrentThinking((prev) => {
                  if (prev && Object.keys(prev.agents).length > 0) {
                    setMessageThinking((mt) => ({
                      ...mt,
                      [fallbackMsg.id]: { ...prev, collapsed: true },
                    }));
                  }
                  return null;
                });
              }

              // Refresh sessions to update title/lastMessage
              loadSessions();
            } else if (event.type === 'error') {
              console.error('SSE error:', event.message);
              setCurrentThinking(null);
            }
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setCurrentThinking(null);
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

  // ── Toggle thinking for a message ───────────────────────────────

  const toggleThinking = (messageId: number) => {
    setMessageThinking((prev) => {
      const existing = prev[messageId];
      if (!existing) return prev;
      return { ...prev, [messageId]: { ...existing, collapsed: !existing.collapsed } };
    });
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
              ) : messages.length === 0 && !sendingMessage ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <MessageCircle size={36} strokeWidth={1.5} />
                  <p className="mt-3 text-sm">開始你的對話吧</p>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto space-y-4">
                  {messages.map((msg) => (
                    <div key={msg.id}>
                      {/* Thinking card rendered before assistant message */}
                      {msg.role === 'assistant' && messageThinking[msg.id] && (
                        <ThinkingCard
                          thinking={messageThinking[msg.id]}
                          isStreaming={false}
                          onToggle={() => toggleThinking(msg.id)}
                        />
                      )}

                      {/* Message bubble */}
                      <div
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
                    </div>
                  ))}

                  {/* Current streaming thinking card */}
                  {sendingMessage && currentThinking && (
                    <ThinkingCard
                      thinking={currentThinking}
                      isStreaming={true}
                      onToggle={() => {}}
                    />
                  )}

                  {/* Fallback typing indicator when no agents have started yet */}
                  {sendingMessage && (!currentThinking || Object.keys(currentThinking.agents).length === 0) && !currentThinking?.phase && (
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
