import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
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
  FolderPlus,
  Folder,
  FolderInput,
  X,
  Image as ImageIcon,
  Copy,
  Check,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────

interface ChatFolder {
  id: number;
  name: string;
  icon: string;
  sort_order: number;
}

interface Session {
  id: number;
  title: string;
  created_at: string;
  lastMessage?: string;
  folder_id: number | null;
}

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  image_url?: string;
  ai_agents?: string;
  dispatch_reason?: string;
  memory_updated?: boolean;
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
  dispatchSummary: string;
  agentReasons: Record<string, string>;
}

interface ChatSSEEvent {
  type: 'phase' | 'agent-start' | 'agent-thinking' | 'agent-done' | 'synthesizing' | 'complete' | 'error' | 'intent' | 'title-updated';
  sessionId?: number;
  title?: string;
  phase?: string;
  message?: string | { id: number; role: string; content: string; created_at: string; ai_agents?: string; dispatch_reason?: string };
  userMessage?: { id: number; role: string; content: string; image_url?: string; created_at: string };
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  agentRole?: string;
  content?: string;
  agents?: Array<{ id: string; name: string; emoji: string; role: string; reason?: string }>;
  reasons?: Record<string, string>;
  summary?: string;
  memoryUpdated?: boolean;
}

interface TodoItem {
  text: string;
  done: boolean;
}

interface TodoBlock {
  title: string | null;
  items: TodoItem[];
}

const TODO_STATE_STORAGE_KEY = 'mind-diary:chat-todo-state';

// ── Agent Color Map ──────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  lele: '#f59e0b',       // amber - joy/sunny
  youyou: '#60a5fa',     // blue - sadness/calm
  nunu: '#ef4444',       // red - anger/fire
  yanyan: '#6b7280',     // gray - disgust/cool
  jingjing: '#8b5cf6',   // violet - fear/tense
  ajiao: '#f97316',      // orange - anxiety/stressed
  amu: '#10b981',        // emerald - envy/growth
  axiu: '#ec4899',       // pink - embarrassment/blush
  afei: '#a78bfa',       // purple-light - ennui/lazy
  nianjiunai: '#d97706', // amber-dark - nostalgia/warm
  awen: '#14b8a6',       // teal - calm/stable
  asi: '#3b82f6',        // blue - reflection/insight
  dran: '#059669',       // green - health/medical
};

function getAgentColor(name: string): string {
  // Try to match by known agent names in Chinese
  const nameMap: Record<string, string> = {
    '樂樂': 'lele',
    '憂憂': 'youyou',
    '怒怒': 'nunu',
    '厭厭': 'yanyan',
    '驚驚': 'jingjing',
    '阿焦': 'ajiao',
    '阿慕': 'amu',
    '阿羞': 'axiu',
    '阿廢': 'afei',
    '念舊嬤': 'nianjiunai',
    '阿穩': 'awen',
    '阿思': 'asi',
    'Dr.安': 'dran',
  };
  const agentId = nameMap[name];
  if (agentId && AGENT_COLORS[agentId]) return AGENT_COLORS[agentId];
  // Fallback: hash-based color
  const colors = Object.values(AGENT_COLORS);
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ── Agent Response Parser ────────────────────────────────────────

interface ParsedAgentResponse {
  emoji: string;
  name: string;
  text: string;
}

function parseAgentResponses(content: string): ParsedAgentResponse[] | null {
  // Match patterns like "😄 樂樂：[response]" separated by double newlines
  const agentPattern = /^([^\s]+)\s+([^\s：:]+)[：:](.+?)(?=\n[^\s]+\s+[^\s：:]+[：:]|\s*$)/gms;
  const results: ParsedAgentResponse[] = [];

  // Split by agent headers: emoji + name + colon
  const sections = content.split(/(?=^[^\n]*?[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]\s+[^\s：:]+[：:])/um);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    // Try to match "emoji name：content"
    const match = trimmed.match(/^([^\s]+)\s+([^\s：:]+)[：:]\s*([\s\S]*)$/);
    if (match) {
      results.push({
        emoji: match[1],
        name: match[2],
        text: match[3].trim(),
      });
    }
  }

  // If we couldn't parse any agents, return null for fallback
  if (results.length === 0) return null;
  // Only treat as agent format if we found at least 1 agent
  return results;
}

// ── Agent Role Map ───────────────────────────────────────────────

const AGENT_ROLES: Record<string, string> = {
  '樂樂': '正向鼓勵師',
  '憂憂': '情感陪伴者',
  '怒怒': '界線捍衛者',
  '厭厭': '品味守護者',
  '驚驚': '風險警報員',
  '阿焦': '焦慮疏導師',
  '阿慕': '目標動力師',
  '阿羞': '社交陪伴者',
  '阿廢': '倦怠偵測師',
  '念舊嬤': '記憶珍藏師',
  '阿穩': '情緒調節師',
  '阿思': '自我覺察師',
  'Dr.安': '身心健康顧問',
};

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
          className="flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] text-xs sm:text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border border-gray-200 dark:border-gray-700 hover:border-indigo-200 dark:hover:border-indigo-700 rounded-lg transition-colors"
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
      <div className="max-w-full lg:max-w-[85%] w-full">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/80 overflow-hidden">
          {/* Phase indicator */}
          {thinking.phase && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
              {isStreaming && <Loader2 size={12} className="animate-spin text-indigo-500" />}
              <span className="text-sm lg:text-xs text-indigo-600 dark:text-indigo-400 font-medium">{thinking.phase}</span>
            </div>
          )}

          {/* Dispatch summary — 夥伴小屋 */}
          {thinking.dispatchSummary && (
            <div className="px-3 py-2.5 border-b border-indigo-100 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs">🏡</span>
                <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">夥伴小屋</span>
              </div>
              <div className="text-xs text-indigo-800 dark:text-indigo-300 leading-relaxed">
                {thinking.dispatchSummary}
              </div>
            </div>
          )}

          {/* Agent cards */}
          <div className="p-2 space-y-1.5">
            {agentEntries.map(([id, agent]) => (
              <div key={id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 min-h-[44px]">
                  <span>{agent.emoji}</span>
                  <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{agent.name}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{agent.role}</span>
                  {thinking.agentReasons[id] && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 italic ml-1">
                      — {thinking.agentReasons[id]}
                    </span>
                  )}
                  {!agent.done && isStreaming && (
                    <Loader2 size={12} className="animate-spin text-indigo-400 ml-auto" />
                  )}
                  {agent.done && <span className="text-xs text-green-500 ml-auto">&#10003;</span>}
                </div>
                <div className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line max-h-32 lg:max-h-48 overflow-y-auto">
                  {agent.text || <span className="text-gray-300 dark:text-gray-600 italic">思考中...</span>}
                </div>
              </div>
            ))}

            {/* Synthesis streaming */}
            {thinking.synthesisText && (
              <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/20 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-100/50 dark:bg-indigo-900/30 border-b border-indigo-200 dark:border-indigo-800">
                  <span>&#129504;</span>
                  <span className="text-xs font-medium text-indigo-900 dark:text-indigo-300">整合者</span>
                  <span className="text-xs text-indigo-400 dark:text-indigo-500">彙整觀點</span>
                  {isStreaming && (
                    <Loader2 size={12} className="animate-spin text-indigo-400 ml-auto" />
                  )}
                </div>
                <div className="px-3 py-1.5 text-xs text-indigo-800 dark:text-indigo-300 leading-relaxed whitespace-pre-line max-h-32 lg:max-h-48 overflow-y-auto">
                  {thinking.synthesisText}
                </div>
              </div>
            )}
          </div>

          {/* Collapse button */}
          {!isStreaming && agentCount > 0 && (
            <button
              onClick={onToggle}
              className="w-full flex items-center justify-center gap-1 px-3 py-2.5 min-h-[44px] text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 border-t border-gray-100 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
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

// ── AgentMessageCard Component ───────────────────────────────────

function AgentMessageCard({
  agent,
  reason,
}: {
  agent: ParsedAgentResponse;
  reason?: string;
}) {
  const color = getAgentColor(agent.name);
  const role = AGENT_ROLES[agent.name] || '';

  return (
    <div
      className="rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden"
      style={{ borderLeftWidth: '4px', borderLeftColor: color }}
    >
      {/* Agent header */}
      <div className="px-3 py-2 flex items-center gap-2">
        <span className="text-base">{agent.emoji}</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{agent.name}</span>
        {role && <span className="text-xs text-gray-400 dark:text-gray-500">· {role}</span>}
      </div>

      {/* Reason */}
      {reason && (
        <div className="px-3 pb-1 text-xs text-gray-400 dark:text-gray-500 italic">
          「{reason}」
        </div>
      )}

      {/* Response content */}
      <div className="px-3 pb-3 text-sm text-gray-800 dark:text-gray-200 leading-relaxed prose prose-sm max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>strong]:text-gray-900 dark:[&>strong]:text-gray-100 break-words">
        <ChatMarkdown messageId={-1}>{agent.text}</ChatMarkdown>
      </div>
    </div>
  );
}

function parseTodoBlocks(content: string): { blocks: TodoBlock[]; remainder: string } {
  const lines = content.split(/\r?\n/);
  const blocks: TodoBlock[] = [];
  const remainder: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const current = lines[i];
    const titleMatch = current.match(/^#{1,6}\s+(.+)$/);
    const firstTaskMatch = current.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/);

    if (titleMatch || firstTaskMatch) {
      const title = titleMatch ? titleMatch[1].trim() : null;
      let j = titleMatch ? i + 1 : i;
      while (j < lines.length && lines[j].trim() === '') j += 1;

      const items: TodoItem[] = [];
      while (j < lines.length) {
        const match = lines[j].match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/);
        if (!match) break;
        items.push({ done: match[1].toLowerCase() === 'x', text: match[2].trim() });
        j += 1;
      }

      if (items.length >= 2) {
        blocks.push({ title, items });
        i = j;
        continue;
      }
    }

    remainder.push(current);
    i += 1;
  }

  return {
    blocks,
    remainder: remainder.join('\n').trim(),
  };
}

function getTodoStorageKey(messageId: number, blockIndex: number) {
  return `${messageId}:${blockIndex}`;
}

function loadStoredTodoState(messageId: number, blockIndex: number, fallbackItems: TodoItem[]): TodoItem[] {
  try {
    const raw = localStorage.getItem(TODO_STATE_STORAGE_KEY);
    if (!raw) return fallbackItems;
    const parsed = JSON.parse(raw) as Record<string, boolean[]>;
    const stored = parsed[getTodoStorageKey(messageId, blockIndex)];
    if (!Array.isArray(stored) || stored.length !== fallbackItems.length) return fallbackItems;
    return fallbackItems.map((item, index) => ({ ...item, done: Boolean(stored[index]) }));
  } catch {
    return fallbackItems;
  }
}

function storeTodoState(messageId: number, blockIndex: number, items: TodoItem[]) {
  try {
    const raw = localStorage.getItem(TODO_STATE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean[]>) : {};
    parsed[getTodoStorageKey(messageId, blockIndex)] = items.map((item) => item.done);
    localStorage.setItem(TODO_STATE_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore storage failures
  }
}

function serializeTodoBlock(block: TodoBlock, items: TodoItem[]) {
  const titleLine = block.title ? `## ${block.title}\n` : '';
  const tasks = items.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`).join('\n');
  return `${titleLine}${tasks}`.trim();
}

function TodoBlockCard({ block, messageId, blockIndex }: { block: TodoBlock; messageId: number; blockIndex: number }) {
  const [items, setItems] = useState<TodoItem[]>(() => loadStoredTodoState(messageId, blockIndex, block.items));
  const [copied, setCopied] = useState(false);
  const completedCount = items.filter((item) => item.done).length;
  const allDone = completedCount === items.length;
  const [collapsed, setCollapsed] = useState(allDone);

  useEffect(() => {
    if (allDone) setCollapsed(true);
  }, [allDone]);

  useEffect(() => {
    setItems(loadStoredTodoState(messageId, blockIndex, block.items));
  }, [block.items, blockIndex, messageId]);

  useEffect(() => {
    storeTodoState(messageId, blockIndex, items);
  }, [blockIndex, items, messageId]);

  const toggleItem = (itemIndex: number) => {
    setItems((current) => current.map((item, index) => (index === itemIndex ? { ...item, done: !item.done } : item)));
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(serializeTodoBlock(block, items));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`my-3 rounded-2xl border overflow-hidden transition-colors ${allDone ? 'border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/80' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex-1 text-left"
        >
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {block.title || `待辦事項`}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            已完成 {completedCount} 個待辦事項（共 {items.length} 個）
          </div>
        </button>
        <button
          type="button"
          onClick={copyMarkdown}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="複製待辦 markdown"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '已複製' : '複製'}
        </button>
        <button type="button" onClick={() => setCollapsed((value) => !value)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-2">
          {items.map((item, index) => (
            <button
              type="button"
              key={`${item.text}-${index}`}
              onClick={() => toggleItem(index)}
              className={`w-full flex items-start gap-3 text-sm text-left rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100/80 dark:hover:bg-gray-800/80 ${item.done ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}
            >
              <input
                type="checkbox"
                checked={item.done}
                readOnly
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 pointer-events-none"
              />
              <span className={item.done ? 'line-through' : ''}>{item.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatMarkdown({ children, messageId }: { children: string; messageId: number }) {
  const { blocks, remainder } = parseTodoBlocks(children);

  return (
    <>
      {blocks.map((block, index) => (
        <TodoBlockCard key={`${messageId}-${block.title || 'todo'}-${index}`} block={block} messageId={messageId} blockIndex={index} />
      ))}
      {remainder && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre: ({ children }) => (
              <pre className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-950 text-gray-100 px-4 py-3 text-xs leading-6">
                {children}
              </pre>
            ),
            code: ({ inline, children, ...props }: any) =>
              inline ? (
                <code className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[0.9em] text-pink-700 dark:text-pink-300" {...props}>
                  {children}
                </code>
              ) : (
                <code {...props}>{children}</code>
              ),
            ul: ({ children, ...props }) => (
              <ul className="my-2 space-y-2 pl-0 list-none" {...props}>
                {children}
              </ul>
            ),
            li: ({ children, ...props }) => (
              <li className="flex items-start gap-2 leading-relaxed" {...props}>
                {children}
              </li>
            ),
            input: ({ checked, ...props }) => (
              <input
                type="checkbox"
                checked={checked}
                readOnly
                disabled
                className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 disabled:opacity-100"
                {...props}
              />
            ),
          }}
        >
          {remainder}
        </ReactMarkdown>
      )}
    </>
  );
}

function isImeConfirming(e: React.KeyboardEvent<HTMLElement>) {
  const nativeEvent = e.nativeEvent as KeyboardEvent;
  return nativeEvent.isComposing || nativeEvent.keyCode === 229;
}

// ── AssistantMessage Component ────────────────────────────────────

function AssistantMessage({
  msg,
  formatTime,
}: {
  msg: Message;
  formatTime: (dateStr: string) => string;
}) {
  // Try to parse agent responses from content
  const parsed = parseAgentResponses(msg.content);

  // Parse ai_agents data for reasons
  let agentReasonsMap: Record<string, string> = {};
  if (msg.ai_agents) {
    try {
      const agentsData = JSON.parse(msg.ai_agents);
      if (Array.isArray(agentsData)) {
        for (const a of agentsData) {
          if (a.name && a.reason) agentReasonsMap[a.name] = a.reason;
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  // New agent card format
  if (parsed && parsed.length > 0) {
    return (
      <div className="flex justify-start">
        <div className="max-w-full lg:max-w-3xl w-full space-y-2">
          {/* Dispatch reason — 夥伴小屋 */}
          {msg.dispatch_reason && (
            <div className="rounded-xl border border-indigo-100 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 px-3 py-2.5 mb-1">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs">🏡</span>
                <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">夥伴小屋</span>
              </div>
              <div className="text-xs text-indigo-800 dark:text-indigo-300 leading-relaxed">
                {msg.dispatch_reason}
              </div>
            </div>
          )}

          {/* Agent cards */}
          {parsed.map((agent, idx) => (
            <AgentMessageCard
              key={idx}
              agent={agent}
              reason={agentReasonsMap[agent.name]}
            />
          ))}

          {/* Timestamp */}
          <div className="text-xs text-gray-400 dark:text-gray-500 px-1 flex items-center gap-2 flex-wrap">
            <span>{formatTime(msg.created_at)}</span>
            {msg.memory_updated && (
              <span className="text-[11px] text-gray-400/80 dark:text-gray-500/80">
                記憶已更新
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Fallback: plain bubble for old messages
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] lg:max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-md">
        <div className="prose prose-sm max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>strong]:text-gray-900 dark:[&>strong]:text-gray-100 break-words">
          <ChatMarkdown messageId={msg.id}>{msg.content}</ChatMarkdown>
        </div>
        <div className="text-xs mt-1.5 text-gray-400 dark:text-gray-500">
          <span>{formatTime(msg.created_at)}</span>
          {msg.memory_updated && <span className="ml-2 text-[11px] opacity-80">記憶已更新</span>}
        </div>
      </div>
    </div>
  );
}

// ── SessionItem Component ────────────────────────────────────────

function SessionItem({
  session,
  isActive,
  isMoving,
  folders,
  indented,
  onSelect,
  onDelete,
  onMoveStart,
  onMoveEnd,
  onMoveTo,
  onRenameTitle,
  formatTime,
}: {
  session: Session;
  isActive: boolean;
  isMoving: boolean;
  folders: ChatFolder[];
  indented: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onMoveStart: () => void;
  onMoveEnd: () => void;
  onMoveTo: (folderId: number | null) => void;
  onRenameTitle: (newTitle: string) => void;
  formatTime: (dateStr: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(session.title || '');
    setEditing(true);
  }

  function commitEdit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session.title) {
      onRenameTitle(trimmed);
    }
    setEditing(false);
  }

  return (
    <div className={`relative ${indented ? 'ml-4' : ''}`}>
      {editing ? (
        <div className="px-3 py-2">
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full text-base lg:text-xs font-medium bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-indigo-400 rounded px-1.5 py-1 focus:outline-none"
          />
        </div>
      ) : (
      <button
        onClick={onSelect}
        onDoubleClick={startEdit}
        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors group flex items-center justify-between gap-1.5 ${
          isActive
            ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate text-xs">
            {session.title || '新對話'}
          </div>
          {session.lastMessage && (
            <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
              {session.lastMessage}
            </div>
          )}
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            {formatTime(session.created_at)}
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={startEdit}
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-all"
            title="重命名"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          {folders.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onMoveStart(); }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-indigo-100 text-gray-400 hover:text-indigo-600 transition-all"
              title="移至資料夾"
            >
              <FolderInput size={13} />
            </button>
          )}
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-all"
            title="刪除對話"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </button>
      )}

      {/* Move-to-folder dropdown */}
      {isMoving && (
        <div data-move-dropdown className="absolute right-0 top-full z-20 mt-1 w-40 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 text-xs">
          <div className="px-3 py-1 text-gray-400 dark:text-gray-500 font-medium">移至...</div>
          {session.folder_id !== null && (
            <button
              onClick={() => onMoveTo(null)}
              className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
            >
              未分類
            </button>
          )}
          {folders
            .filter((f) => f.id !== session.folder_id)
            .map((f) => (
              <button
                key={f.id}
                onClick={() => onMoveTo(f.id)}
                className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 truncate"
              >
                {f.icon ? `${f.icon} ` : ''}{f.name}
              </button>
            ))}
          <button
            onClick={onMoveEnd}
            className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 mt-1"
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // default closed on mobile

  // Folder state
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<number>>(new Set());
  const isComposingRef = useRef(false);
  const sendCancelledRef = useRef(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [movingSessionId, setMovingSessionId] = useState<number | null>(null);

  // SSE reconnect refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeSessionIdRef = useRef<number | null>(null);
  const sendingMessageRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { sendingMessageRef.current = sendingMessage; }, [sendingMessage]);

  // Thinking state for current streaming message
  const [currentThinking, setCurrentThinking] = useState<ThinkingData | null>(null);
  // Stored thinking data keyed by the assistant message id that follows it
  const [messageThinking, setMessageThinking] = useState<Record<number, ThinkingData>>({});

  // Image attachment for chat
  const [chatImage, setChatImage] = useState<File | null>(null);
  const [chatImagePreview, setChatImagePreview] = useState<string | null>(null);
  const chatImageInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Detect desktop on mount to auto-open sidebar
  useEffect(() => {
    if (window.innerWidth >= 1024) {
      setSidebarOpen(true);
    }
  }, []);

  // Close move dropdown on outside click
  useEffect(() => {
    if (movingSessionId === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-move-dropdown]')) {
        setMovingSessionId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [movingSessionId]);

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

  // ── Load folders ─────────────────────────────────────────────────

  const loadFolders = useCallback(async () => {
    try {
      const data = await apiClient.get<ChatFolder[] | { folders: ChatFolder[] }>(
        '/api/chat/folders',
      );
      const list = Array.isArray(data) ? data : data?.folders || [];
      setFolders(list.sort((a, b) => a.sort_order - b.sort_order));
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadFolders();
  }, [loadSessions, loadFolders]);

  // ── Load messages for active session ────────────────────────────

  const loadMessages = useCallback(async (sessionId: number) => {
    setLoading(true);
    try {
      const data = await apiClient.get<Message[] | { messages: Message[] }>(
        `/api/chat/sessions/${sessionId}/messages`,
      );
      const list = Array.isArray(data) ? data : data?.messages || [];
      setMessages(list);

      // Reconstruct thinking data from saved ai_agents + dispatch_reason
      const thinkingMap: Record<number, ThinkingData> = {};
      for (const msg of list) {
        if (msg.role === 'assistant' && msg.ai_agents) {
          try {
            const agents = JSON.parse(msg.ai_agents);
            if (Array.isArray(agents) && agents.length > 0) {
              const agentStates: Record<string, AgentThinkingState> = {};
              const agentReasons: Record<string, string> = {};
              for (const a of agents) {
                if (!a.id) continue;
                agentStates[a.id] = {
                  name: a.name || a.id,
                  emoji: a.emoji || '🤖',
                  role: a.role || '',
                  text: a.text || '',
                  done: true,
                };
                agentReasons[a.id] = a.reason || '';
              }
              thinkingMap[msg.id] = {
                agents: agentStates,
                synthesisText: '',
                phase: '',
                collapsed: true,
                dispatchSummary: msg.dispatch_reason || '',
                agentReasons,
              };
            }
          } catch { /* ignore */ }
        }
      }
      setMessageThinking(thinkingMap);
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

  // ── SSE reconnect on page visibility change (mobile background) ─
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && abortControllerRef.current) {
        // Page returned to foreground while SSE was active → abort SSE
        // The finally block in sendMessage will reload from DB
        abortControllerRef.current.abort();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // ── Create new session ──────────────────────────────────────────

  const createSession = async () => {
    try {
      const session = await apiClient.post<Session>('/api/chat/sessions');
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
      // Close sidebar on mobile after creating
      if (window.innerWidth < 1024) setSidebarOpen(false);
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

  // ── Folder management ────────────────────────────────────────────

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const folder = await apiClient.post<ChatFolder>('/api/chat/folders', { name });
      setFolders((prev) => [...prev, folder]);
      setNewFolderName('');
      setShowNewFolder(false);
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  const deleteFolder = async (folderId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('確定要刪除這個資料夾嗎？裡面的對話會移到「未分類」。')) return;
    try {
      await apiClient.delete(`/api/chat/folders/${folderId}`);
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      // Move sessions from deleted folder to uncategorized
      setSessions((prev) =>
        prev.map((s) => (s.folder_id === folderId ? { ...s, folder_id: null } : s)),
      );
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  };

  const renameSession = async (sessionId: number, newTitle: string) => {
    try {
      await apiClient.put(`/api/chat/sessions/${sessionId}`, { title: newTitle });
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
  };

  const moveSessionToFolder = async (sessionId: number, folderId: number | null) => {
    try {
      await apiClient.put(`/api/chat/sessions/${sessionId}`, { folder_id: folderId });
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, folder_id: folderId } : s)),
      );
    } catch (err) {
      console.error('Failed to move session:', err);
    } finally {
      setMovingSessionId(null);
    }
  };

  const toggleFolder = (folderId: number) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  // ── Select session (auto-close sidebar on mobile) ───────────────

  const selectSession = (sessionId: number) => {
    setActiveSessionId(sessionId);
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  // ── Group sessions by folder ────────────────────────────────────

  const sessionsByFolder = (() => {
    const map: Record<string, Session[]> = { uncategorized: [] };
    for (const f of folders) map[f.id] = [];
    for (const s of sessions) {
      const key = s.folder_id && map[s.folder_id] ? String(s.folder_id) : 'uncategorized';
      map[key] = map[key] || [];
      map[key].push(s);
    }
    return map;
  })();

  // ── Chat image helpers ──────────────────────────────────────────

  const attachChatImage = (file: File) => {
    const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) return;
    if (chatImagePreview) URL.revokeObjectURL(chatImagePreview);
    setChatImage(file);
    setChatImagePreview(URL.createObjectURL(file));
  };

  const clearChatImage = () => {
    if (chatImagePreview) URL.revokeObjectURL(chatImagePreview);
    setChatImage(null);
    setChatImagePreview(null);
  };

  const handleInputPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length > 0) {
      const file = e.clipboardData.files[0];
      if (file.type.startsWith('image/')) {
        e.preventDefault();
        attachChatImage(file);
      }
    }
  };

  // ── Send message (SSE streaming) ────────────────────────────────

  const sendMessage = async () => {
    const content = input.trim();
    if ((!content && !chatImage) || sendingMessage) return;

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

    const imageFile = chatImage;
    const messageContent = content || (imageFile ? '🖼️ [圖片]' : '');
    const originalInput = input;

    setInput('');
    clearChatImage();
    setSendingMessage(true);
    sendCancelledRef.current = false;

    // Optimistic: add user message immediately (with local preview URL for image)
    const tempUserMsg: Message = {
      id: Date.now(),
      role: 'user',
      content: messageContent,
      created_at: new Date().toISOString(),
      image_url: imageFile ? URL.createObjectURL(imageFile) : undefined,
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // Initialize thinking state
    const thinking: ThinkingData = {
      agents: {},
      synthesisText: '',
      phase: '',
      collapsed: false,
      dispatchSummary: '',
      agentReasons: {},
    };
    setCurrentThinking(thinking);

    // AbortController for SSE — allows aborting when page goes to background
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;
    let gotComplete = false;

    try {
      let response: Response;
      if (imageFile) {
        const fd = new FormData();
        fd.append('content', messageContent);
        fd.append('image', imageFile);
        response = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
          method: 'POST',
          body: fd,
          signal: abortCtrl.signal,
        });
      } else {
        response = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
          signal: abortCtrl.signal,
        });
      }

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

            if (event.type === 'intent') {
              setCurrentThinking((prev) => {
                // Re-initialize if null (e.g. race condition when auto-creating new session)
                const base: ThinkingData = prev || { agents: {}, synthesisText: '', phase: '', collapsed: false, dispatchSummary: '', agentReasons: {} };
                // Pre-populate agent cards from intent so reasoning shows immediately
                const prePopulated: Record<string, AgentThinkingState> = {};
                if (event.agents) {
                  for (const a of event.agents) {
                    prePopulated[a.id] = {
                      name: a.name,
                      emoji: a.emoji,
                      role: a.role,
                      text: '',
                      done: false,
                    };
                  }
                }
                return {
                  ...base,
                  dispatchSummary: event.summary || base.dispatchSummary,
                  agentReasons: event.reasons || base.agentReasons,
                  agents: { ...prePopulated, ...base.agents },
                };
              });
            } else if (event.type === 'phase') {
              setCurrentThinking((prev) => {
                // Re-initialize if null (race condition with new session creation)
                const base: ThinkingData = prev || { agents: {}, synthesisText: '', phase: '', collapsed: false, dispatchSummary: '', agentReasons: {} };
                return { ...base, phase: (typeof event.message === 'string' ? event.message : event.phase) || '' };
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
              gotComplete = true;
              // Extract the assistant message from the event
              const msg = event.message;
              if (msg && typeof msg === 'object' && 'id' in msg) {
                const assistantMsg: Message = {
                  id: msg.id,
                  role: msg.role as 'assistant',
                  content: msg.content,
                  created_at: msg.created_at,
                  ai_agents: msg.ai_agents,
                  dispatch_reason: msg.dispatch_reason,
                  memory_updated: event.memoryUpdated,
                };

                // Replace temp user message with real one (has server image_url), then add assistant
                setMessages((prev) => {
                  const withoutTemp = prev.filter((m) => m.id !== tempUserMsg.id);
                  const realUser: Message | undefined = event.userMessage
                    ? {
                        id: event.userMessage.id,
                        role: 'user',
                        content: event.userMessage.content,
                        image_url: event.userMessage.image_url ?? undefined,
                        created_at: event.userMessage.created_at,
                      }
                    : undefined;
                  return realUser
                    ? [...withoutTemp, realUser, assistantMsg]
                    : [...withoutTemp, assistantMsg];
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
                  memory_updated: event.memoryUpdated,
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

              // Refresh sessions to update lastMessage (title may update via title-updated)
              loadSessions();
            } else if (event.type === 'title-updated' && event.sessionId && event.title) {
              setSessions(prev => prev.map(s => s.id === event.sessionId ? { ...s, title: event.title! } : s));
            } else if (event.type === 'error') {
              console.error('SSE error:', event.message);
              setCurrentThinking(null);
            }
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        const wasCancelled = sendCancelledRef.current;
        if (wasCancelled) {
          setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
          setCurrentThinking(null);
          setInput(originalInput);
          if (imageFile) {
            setChatImage(imageFile);
            setChatImagePreview(URL.createObjectURL(imageFile));
          }
        }
      } else {
        console.error('Failed to send message:', err);
        // Remove optimistic message on real error
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
        setCurrentThinking(null);
        setInput(messageContent !== '🖼️ [圖片]' ? messageContent : ''); // restore input
      }
    } finally {
      abortControllerRef.current = null;
      // If SSE ended without a complete event (connection drop / abort), reload from DB
      // unless the user explicitly cancelled this send.
      if (!gotComplete && sessionId && !sendCancelledRef.current) {
        try {
          await loadMessages(sessionId);
        } catch {
          // ignore reload errors
        }
      }
      setCurrentThinking(null);
      setSendingMessage(false);
      inputRef.current?.focus();
    }
  };

  const cancelInFlightMessage = () => {
    sendCancelledRef.current = true;
    abortControllerRef.current?.abort();
  };

  // ── Key handler for textarea ────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current || isImeConfirming(e)) return;
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
    // SQLite stores UTC without timezone suffix — add Z so JS parses as UTC, then converts to local
    const normalized = /Z|[+-]\d{2}:?\d{2}$/.test(dateStr)
      ? dateStr
      : dateStr.replace(' ', 'T') + 'Z';
    const d = new Date(normalized);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' });
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="-m-6 flex h-[calc(100vh-4rem)] lg:h-screen relative">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden transition-opacity duration-200"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — mobile: fixed overlay when open, hidden when closed; desktop: inline push */}
      <div
        className={`
          ${sidebarOpen
            ? 'fixed inset-y-0 left-0 z-40 w-72 lg:static lg:z-auto'
            : 'hidden lg:block lg:w-0 lg:overflow-hidden'
          }
          flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 transition-[width] duration-200
        `}
      >
        <div className="w-72 h-full flex flex-col">
          {/* Sidebar header */}
          <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">對話紀錄</h2>
            <div className="flex items-center gap-1.5">
              <button
                onClick={createSession}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Plus size={14} />
                新增對話
              </button>
              {/* Close button on mobile */}
              <button
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* New folder button / input */}
          <div className="px-3 pt-2">
            {showNewFolder ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createFolder();
                    if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); }
                  }}
                  placeholder="資料夾名稱"
                  className="flex-1 min-w-0 text-base lg:text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <button onClick={createFolder} className="p-1 text-indigo-600 hover:text-indigo-800" title="確認"><Plus size={14} /></button>
                <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="p-1 text-gray-400 hover:text-gray-600" title="取消"><X size={14} /></button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewFolder(true)}
                className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
              >
                <FolderPlus size={13} />
                新增資料夾
              </button>
            )}
          </div>

          {/* Session list grouped by folder */}
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {sessions.length === 0 && folders.length === 0 && (
              <p className="text-center text-sm text-gray-400 dark:text-gray-500 mt-8">
                尚無對話紀錄
              </p>
            )}

            {/* Folders */}
            {folders.map((folder) => {
              const folderSessions = sessionsByFolder[folder.id] || [];
              const isCollapsed = collapsedFolders.has(folder.id);
              return (
                <div key={folder.id}>
                  {/* Folder header */}
                  <button
                    onClick={() => toggleFolder(folder.id)}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
                  >
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <Folder size={14} className="text-indigo-400" />
                    <span className="truncate flex-1 text-left">{folder.icon ? `${folder.icon} ` : ''}{folder.name}</span>
                    <span className="text-[10px] text-gray-400 mr-1">{folderSessions.length}</span>
                    <button
                      onClick={(e) => deleteFolder(folder.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-all"
                      title="刪除資料夾"
                    >
                      <Trash2 size={12} />
                    </button>
                  </button>

                  {/* Sessions inside folder */}
                  {!isCollapsed && folderSessions.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      isActive={activeSessionId === session.id}
                      isMoving={movingSessionId === session.id}
                      folders={folders}
                      indented
                      onSelect={() => selectSession(session.id)}
                      onDelete={(e) => deleteSession(session.id, e)}
                      onMoveStart={() => setMovingSessionId(session.id)}
                      onMoveEnd={() => setMovingSessionId(null)}
                      onMoveTo={(fid) => moveSessionToFolder(session.id, fid)}
                      onRenameTitle={(t) => renameSession(session.id, t)}
                      formatTime={formatTime}
                    />
                  ))}
                </div>
              );
            })}

            {/* Uncategorized section */}
            {sessionsByFolder.uncategorized.length > 0 && (
              <div>
                {folders.length > 0 && (
                  <div className="px-2 pt-2 pb-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    未分類
                  </div>
                )}
                {sessionsByFolder.uncategorized.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={activeSessionId === session.id}
                    isMoving={movingSessionId === session.id}
                    folders={folders}
                    indented={false}
                    onSelect={() => selectSession(session.id)}
                    onDelete={(e) => deleteSession(session.id, e)}
                    onMoveStart={() => setMovingSessionId(session.id)}
                    onMoveEnd={() => setMovingSessionId(null)}
                    onMoveTo={(fid) => moveSessionToFolder(session.id, fid)}
                    onRenameTitle={(t) => renameSession(session.id, t)}
                    formatTime={formatTime}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-gray-950">
        {!user && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-400">
            訪客模式 — 您的對話紀錄存放在公共空間。<a href="/login" className="underline font-medium ml-1">登入</a>以使用個人對話。
          </div>
        )}
        {/* Chat header */}
        <div className="flex items-center gap-3 px-3 lg:px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
            title={sidebarOpen ? '收起側欄' : '展開側欄'}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate">
            {activeSessionId
              ? sessions.find((s) => s.id === activeSessionId)?.title || '對話'
              : 'AI 對話'}
          </h2>
        </div>

        {/* Messages or empty state */}
        {!activeSessionId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 px-4">
            <MessageCircle size={36} className="lg:w-12 lg:h-12" strokeWidth={1.5} />
            <p className="mt-3 text-base lg:text-lg">選擇或建立對話</p>
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
            <div className="flex-1 overflow-y-auto px-3 py-4 lg:px-4 lg:py-6">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 size={24} className="animate-spin text-indigo-500" />
                </div>
              ) : messages.length === 0 && !sendingMessage ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500">
                  <MessageCircle size={32} className="lg:w-9 lg:h-9" strokeWidth={1.5} />
                  <p className="mt-3 text-sm">開始對話吧</p>
                </div>
              ) : (
                <div className="max-w-full lg:max-w-3xl mx-auto space-y-4">
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

                      {/* Message */}
                      {msg.role === 'user' ? (
                        <div className="flex justify-end">
                          <div className="max-w-[85%] lg:max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-indigo-600 text-white rounded-br-md">
                            {msg.image_url && (
                              <div className="mb-2">
                                <img
                                  src={msg.image_url}
                                  alt="上傳的圖片"
                                  className="max-w-full rounded-lg max-h-64 object-contain"
                                />
                              </div>
                            )}
                            {msg.content && msg.content !== '🖼️ [圖片]' && (
                              <div className="whitespace-pre-wrap break-words">
                                {msg.content}
                              </div>
                            )}
                            <div className="text-xs mt-1.5 text-indigo-200">
                              {formatTime(msg.created_at)}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <AssistantMessage msg={msg} formatTime={formatTime} />
                      )}
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
                      <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-md px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Loader2 size={14} className="animate-spin text-gray-400" />
                          <span className="text-sm text-gray-400 dark:text-gray-500">AI 思考中...</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input bar */}
            <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 lg:px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="max-w-full lg:max-w-3xl mx-auto space-y-2">
                {/* Image preview */}
                {chatImagePreview && (
                  <div className="flex items-center gap-2 px-1">
                    <div className="relative group w-16 h-16 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 shrink-0">
                      <img src={chatImagePreview} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={clearChatImage}
                        className="absolute top-0.5 right-0.5 p-0.5 bg-black/60 text-white rounded-full hover:bg-red-600 transition-colors"
                      >
                        <X size={10} />
                      </button>
                    </div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">圖片已附加，AI 將分析此圖片</span>
                  </div>
                )}

                <div className="flex items-end gap-2 lg:gap-3">
                  {/* Image attach button */}
                  <button
                    onClick={() => chatImageInputRef.current?.click()}
                    disabled={sendingMessage}
                    className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors disabled:opacity-40"
                    title="附加圖片"
                  >
                    <ImageIcon size={18} />
                  </button>
                  <input
                    ref={chatImageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    onChange={e => { if (e.target.files?.[0]) attachChatImage(e.target.files[0]); e.target.value = ''; }}
                  />

                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onCompositionStart={() => {
                      isComposingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                      isComposingRef.current = false;
                    }}
                    onKeyDown={handleKeyDown}
                    onPaste={handleInputPaste}
                    placeholder={chatImage ? '補充圖片說明（可選）...' : '輸入訊息或貼上圖片...'}
                    rows={1}
                    className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-3 lg:px-4 py-2.5 text-base lg:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent max-h-32 overflow-y-auto"
                    style={{ height: 'auto', minHeight: '2.75rem' }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = Math.min(target.scrollHeight, 128) + 'px';
                    }}
                    disabled={sendingMessage}
                  />
                  <button
                    onClick={sendingMessage ? cancelInFlightMessage : sendMessage}
                    disabled={!sendingMessage && !input.trim() && !chatImage}
                    className={`flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${sendingMessage ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                    title={sendingMessage ? '取消送出' : '發送訊息'}
                  >
                    {sendingMessage ? (
                      <X size={18} />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
