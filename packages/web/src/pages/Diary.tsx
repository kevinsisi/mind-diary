import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import {
  Plus,
  Tag,
  Pencil,
  Trash2,
  X,
  Save,
  Sparkles,
  RefreshCw,
  ChevronRight,
  BookOpen,
  Loader2,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────

interface AgentResult {
  agentId: string;
  name: string;
  emoji: string;
  role: string;
  result: string;
}

interface DiaryEntry {
  id: number;
  title: string;
  content: string;
  mood: string | null;
  ai_reflection: string | null;
  ai_agents: AgentResult[] | null;
  tags: string[];
  folder_id: number | null;
  created_at: string;
  updated_at: string;
}

interface AnalysisEvent {
  type: 'phase' | 'agent-start' | 'agent-thinking' | 'agent-done' | 'synthesizing' | 'done' | 'error' | 'tags' | 'complete';
  phase?: string;
  message?: string;
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  agentRole?: string;
  content?: string;
  tags?: string[];
  reflection?: string;
  agents?: Array<{ id: string; name: string; emoji: string; role: string }>;
  agentResults?: AgentResult[];
}

interface FolderItem {
  id: number;
  name: string;
  parent_id: number | null;
  icon: string;
  sort_order: number;
}

interface TagItem {
  id: number;
  name: string;
  color: string;
  count: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ── Constants ──────────────────────────────────────────────────────

const MOOD_MAP: Record<string, string> = {
  happy: '😊',
  sad: '😢',
  angry: '😡',
  calm: '😌',
  thinking: '🤔',
  love: '😍',
  strong: '💪',
  tired: '😴',
};

const MOOD_ENTRIES = Object.entries(MOOD_MAP);

// ── Helpers ────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(text: string, lines: number): string {
  const parts = text.split('\n').slice(0, lines);
  const result = parts.join('\n');
  return result.length < text.length ? result + '…' : result;
}

// ── Component ──────────────────────────────────────────────────────

export default function Diary() {
  // Data
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  // Selection / filter
  const [selectedEntry, setSelectedEntry] = useState<DiaryEntry | null>(null);
  const [activeFolder, setActiveFolder] = useState<number | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Edit state
  const [editMode, setEditMode] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editMood, setEditMood] = useState<string | null>(null);
  const [editFolderId, setEditFolderId] = useState<number | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // Folder creation
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Loading
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Analysis streaming state
  const [analysisPhase, setAnalysisPhase] = useState('');
  const [activeAgents, setActiveAgents] = useState<Array<{ id: string; name: string; emoji: string; role: string }>>([]);
  const [agentThinking, setAgentThinking] = useState<Record<string, { name: string; emoji: string; role: string; text: string; done: boolean }>>({});
  const [synthesisText, setSynthesisText] = useState('');
  const [showThinking, setShowThinking] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  // ── Fetchers ───────────────────────────────────────────────────

  const fetchEntries = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: '20' });
        if (activeFolder !== null) params.set('folder_id', String(activeFolder));
        if (activeTag !== null) params.set('tag', activeTag);
        const res = await apiClient.get<{ entries: DiaryEntry[]; pagination: Pagination }>(
          `/api/diary?${params}`,
        );
        setEntries(res.entries);
        setPagination(res.pagination);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    },
    [activeFolder, activeTag],
  );

  const fetchFolders = useCallback(async () => {
    try {
      const res = await apiClient.get<{ folders: FolderItem[] }>('/api/folders');
      setFolders(res.folders || []);
    } catch {
      // silent
    }
  }, []);

  const fetchTags = useCallback(async () => {
    try {
      const res = await apiClient.get<{ tags: TagItem[] }>('/api/tags');
      setTags(res.tags || []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchFolders();
    fetchTags();
  }, [fetchFolders, fetchTags]);

  useEffect(() => {
    fetchEntries(1);
    listRef.current?.scrollTo({ top: 0 });
  }, [fetchEntries]);

  // ── Handlers ───────────────────────────────────────────────────

  function startNew() {
    setSelectedEntry(null);
    setEditMode(true);
    setIsNew(true);
    setEditTitle('');
    setEditContent('');
    setEditMood(null);
    setEditFolderId(activeFolder);
    setEditTags([]);
    setTagInput('');
  }

  function startEdit(entry: DiaryEntry) {
    setEditMode(true);
    setIsNew(false);
    setEditTitle(entry.title);
    setEditContent(entry.content);
    setEditMood(entry.mood);
    setEditFolderId(entry.folder_id);
    setEditTags([...entry.tags]);
    setTagInput('');
  }

  function cancelEdit() {
    setEditMode(false);
    if (isNew) {
      setSelectedEntry(null);
    }
    setIsNew(false);
  }

  async function handleSave() {
    if (!editTitle.trim() || !editContent.trim()) return;
    setSaving(true);
    try {
      if (isNew) {
        const body: Record<string, unknown> = {
          title: editTitle.trim(),
          content: editContent.trim(),
        };
        if (editMood) body.mood = editMood;
        if (editFolderId !== null) body.folder_id = editFolderId;
        const created = await apiClient.post<DiaryEntry>('/api/diary', body);
        setSelectedEntry(created);
        setEntries((prev) => [created, ...prev]);
        // Auto-trigger multi-agent analysis
        setTimeout(() => handleAnalyze(created), 100);
      } else if (selectedEntry) {
        const body: Record<string, unknown> = {
          title: editTitle.trim(),
          content: editContent.trim(),
          mood: editMood,
          folder_id: editFolderId,
          tags: editTags,
        };
        const updated = await apiClient.put<DiaryEntry>(`/api/diary/${selectedEntry.id}`, body);
        setSelectedEntry(updated);
        setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      }
      setEditMode(false);
      setIsNew(false);
      fetchTags();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedEntry) return;
    if (!window.confirm('確定要刪除這篇日記嗎？')) return;
    try {
      await apiClient.delete(`/api/diary/${selectedEntry.id}`);
      setEntries((prev) => prev.filter((e) => e.id !== selectedEntry.id));
      setSelectedEntry(null);
      setEditMode(false);
      fetchTags();
    } catch {
      // silent
    }
  }

  async function handleAnalyze(entry?: DiaryEntry) {
    const target = entry || selectedEntry;
    if (!target) return;
    setAnalyzing(true);
    setShowThinking(true);
    setAnalysisPhase('');
    setActiveAgents([]);
    setAgentThinking({});
    setSynthesisText('');

    try {
      const response = await fetch(`/api/diary/${target.id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
            const event: AnalysisEvent = JSON.parse(line.slice(6));

            if (event.type === 'phase' && event.agents) {
              setActiveAgents(event.agents);
              setAnalysisPhase(event.message || '');
            } else if (event.type === 'phase') {
              setAnalysisPhase(event.message || '');
            } else if (event.type === 'agent-start' && event.agentId) {
              setAgentThinking(prev => ({
                ...prev,
                [event.agentId!]: { name: event.agentName || '', emoji: event.agentEmoji || '', role: event.agentRole || '', text: '', done: false },
              }));
            } else if (event.type === 'agent-thinking' && event.agentId) {
              setAgentThinking(prev => ({
                ...prev,
                [event.agentId!]: {
                  ...prev[event.agentId!],
                  text: (prev[event.agentId!]?.text || '') + (event.content || ''),
                },
              }));
            } else if (event.type === 'agent-done' && event.agentId) {
              setAgentThinking(prev => ({
                ...prev,
                [event.agentId!]: { ...prev[event.agentId!], done: true },
              }));
            } else if (event.type === 'synthesizing' && event.content) {
              setSynthesisText(prev => prev + event.content);
            } else if (event.type === 'complete') {
              const updated: DiaryEntry = {
                ...target,
                ai_reflection: event.reflection || null,
                ai_agents: event.agentResults || null,
                tags: event.tags || target.tags,
              };
              setSelectedEntry(updated);
              setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
              fetchTags();
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch {
      // silent
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    try {
      await apiClient.post('/api/folders', { name: newFolderName.trim() });
      setNewFolderName('');
      setShowNewFolder(false);
      fetchFolders();
    } catch {
      // silent
    }
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !editTags.includes(t)) {
      setEditTags((prev) => [...prev, t]);
    }
    setTagInput('');
  }

  function removeTag(t: string) {
    setEditTags((prev) => prev.filter((x) => x !== t));
  }

  // ── Filter label ───────────────────────────────────────────────

  function filterLabel(): string | null {
    if (activeFolder !== null) {
      const f = folders.find((f) => f.id === activeFolder);
      return f ? `${f.icon} ${f.name}` : null;
    }
    if (activeTag) return `# ${activeTag}`;
    return null;
  }

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-7rem)] lg:h-[calc(100vh-3rem)] -m-6 bg-gray-50">
      {/* ── Left Sidebar ──────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-60 border-r border-gray-200 bg-white shrink-0">
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            資料夾
          </h3>

          {/* All entries */}
          <button
            onClick={() => {
              setActiveFolder(null);
              setActiveTag(null);
            }}
            className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeFolder === null && activeTag === null
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <BookOpen size={16} />
            所有日記
          </button>

          {/* Folder list */}
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setActiveFolder(f.id);
                setActiveTag(null);
              }}
              className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeFolder === f.id
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span className="text-base leading-none">{f.icon || '📁'}</span>
              <span className="truncate">{f.name}</span>
            </button>
          ))}

          {/* New folder */}
          {showNewFolder ? (
            <div className="flex items-center gap-1 mt-1">
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') setShowNewFolder(false);
                }}
                placeholder="資料夾名稱"
                className="flex-1 min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <button
                onClick={handleCreateFolder}
                className="p-1 text-indigo-600 hover:text-indigo-800"
              >
                <Save size={14} />
              </button>
              <button
                onClick={() => setShowNewFolder(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewFolder(true)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Plus size={14} />
              新增資料夾
            </button>
          )}
        </div>

        {/* Tags */}
        <div className="p-4 flex-1 overflow-y-auto">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            標籤
          </h3>
          {tags.length === 0 ? (
            <p className="text-xs text-gray-400">尚無標籤</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTag(activeTag === t.name ? null : t.name);
                    setActiveFolder(null);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                    activeTag === t.name
                      ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  style={
                    activeTag !== t.name && t.color
                      ? { backgroundColor: t.color + '22', color: t.color }
                      : undefined
                  }
                >
                  {t.name}
                  <span className="text-[10px] opacity-60">{t.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ── Center Panel (Entry List) ─────────────────────────── */}
      <div className="flex flex-col w-full md:w-80 lg:w-96 border-r border-gray-200 bg-white shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate">心靈日記</h2>
            {filterLabel() && (
              <div className="flex items-center gap-1 text-xs text-indigo-600 mt-0.5">
                <ChevronRight size={12} />
                <span className="truncate">{filterLabel()}</span>
                <button
                  onClick={() => {
                    setActiveFolder(null);
                    setActiveTag(null);
                  }}
                  className="ml-1 text-gray-400 hover:text-gray-600"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
          <button
            onClick={startNew}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shrink-0"
          >
            <Plus size={14} />
            新增日記
          </button>
        </div>

        {/* List */}
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400">
              <Loader2 size={20} className="animate-spin mr-2" />
              載入中...
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400">
              <BookOpen size={32} className="mb-2 opacity-50" />
              <p className="text-sm">開始寫第一篇日記吧</p>
            </div>
          ) : (
            <>
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => {
                    setSelectedEntry(entry);
                    setEditMode(false);
                    setIsNew(false);
                  }}
                  className={`w-full text-left p-4 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                    selectedEntry?.id === entry.id ? 'border-l-2 border-l-indigo-500 bg-indigo-50/40' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-medium text-gray-900 text-sm truncate">{entry.title}</h4>
                    {entry.mood && (
                      <span className="text-base shrink-0">{MOOD_MAP[entry.mood] ?? entry.mood}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(entry.created_at)}</p>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2 whitespace-pre-line">
                    {truncate(entry.content, 2)}
                  </p>
                  {entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {entry.tags.map((t) => {
                        const tagObj = tags.find((x) => x.name === t);
                        return (
                          <span
                            key={t}
                            className="inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500"
                            style={
                              tagObj?.color
                                ? { backgroundColor: tagObj.color + '22', color: tagObj.color }
                                : undefined
                            }
                          >
                            {t}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </button>
              ))}

              {/* Pagination */}
              {pagination.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 p-3">
                  <button
                    disabled={pagination.page <= 1}
                    onClick={() => fetchEntries(pagination.page - 1)}
                    className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40"
                  >
                    上一頁
                  </button>
                  <span className="text-xs text-gray-400">
                    {pagination.page} / {pagination.totalPages}
                  </span>
                  <button
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => fetchEntries(pagination.page + 1)}
                    className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40"
                  >
                    下一頁
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Right Panel (Detail / Editor) ─────────────────────── */}
      <div className="hidden lg:flex flex-col flex-1 min-w-0 bg-white">
        {!selectedEntry && !editMode ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-300">
            <BookOpen size={48} className="mb-3 opacity-40" />
            <p className="text-sm">選擇一篇日記或新增一篇</p>
          </div>
        ) : editMode ? (
          /* ── EDIT MODE ────────────────────────────────────────── */
          <div className="flex flex-col h-full">
            {/* Edit header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">
                {isNew ? '新增日記' : '編輯日記'}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelEdit}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !editTitle.trim() || !editContent.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  儲存
                </button>
              </div>
            </div>

            {/* Edit form */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">標題</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="為這篇日記取個標題..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                />
              </div>

              {/* Content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">內容</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="寫下你的心情與想法..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-y"
                  style={{ minHeight: '200px' }}
                />
              </div>

              {/* Mood */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">心情</label>
                <div className="flex flex-wrap gap-2">
                  {MOOD_ENTRIES.map(([key, emoji]) => (
                    <button
                      key={key}
                      onClick={() => setEditMood(editMood === key ? null : key)}
                      className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all ${
                        editMood === key
                          ? 'bg-indigo-100 ring-2 ring-indigo-400 scale-110'
                          : 'bg-gray-50 hover:bg-gray-100'
                      }`}
                      title={key}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Folder */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">資料夾</label>
                <select
                  value={editFolderId ?? ''}
                  onChange={(e) =>
                    setEditFolderId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent bg-white"
                >
                  <option value="">未分類</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.icon} {f.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tags */}
              {!isNew && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">標籤</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {editTags.map((t) => {
                      const tagObj = tags.find((x) => x.name === t);
                      return (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
                          style={
                            tagObj?.color
                              ? { backgroundColor: tagObj.color + '22', color: tagObj.color }
                              : undefined
                          }
                        >
                          {t}
                          <button
                            onClick={() => removeTag(t)}
                            className="hover:text-red-500 transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder="輸入標籤後按 Enter"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                    />
                    <button
                      onClick={addTag}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      新增
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : selectedEntry ? (
          /* ── VIEW MODE ────────────────────────────────────────── */
          <div className="flex flex-col h-full">
            {/* View header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900 truncate">{selectedEntry.title}</h3>
                  {selectedEntry.mood && (
                    <span className="text-xl">{MOOD_MAP[selectedEntry.mood] ?? selectedEntry.mood}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDateTime(selectedEntry.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => startEdit(selectedEntry)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                >
                  <Pencil size={14} />
                  編輯
                </button>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 size={14} />
                  刪除
                </button>
              </div>
            </div>

            {/* View body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Tags */}
              {selectedEntry.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedEntry.tags.map((t) => {
                    const tagObj = tags.find((x) => x.name === t);
                    return (
                      <button
                        key={t}
                        onClick={() => {
                          setActiveTag(t);
                          setActiveFolder(null);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                        style={
                          tagObj?.color
                            ? { backgroundColor: tagObj.color + '22', color: tagObj.color }
                            : undefined
                        }
                      >
                        <Tag size={10} />
                        {t}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Content */}
              <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">
                {selectedEntry.content}
              </div>

              {/* AI Analysis Section */}
              <div className="mt-6 space-y-3">
                {/* Header + button */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-indigo-700">
                    <Sparkles size={16} />
                    AI 好友分析
                  </div>
                  <button
                    onClick={() => handleAnalyze()}
                    disabled={analyzing}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {analyzing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {selectedEntry.ai_reflection ? '重新分析' : '開始分析'}
                  </button>
                </div>

                {/* Thinking Process (visible during & after analysis) */}
                {(analyzing || showThinking) && Object.keys(agentThinking).length > 0 && (
                  <div className="space-y-2">
                    {analysisPhase && (
                      <div className="text-xs text-indigo-500 font-medium">{analysisPhase}</div>
                    )}
                    {Object.entries(agentThinking).map(([id, agent]) => (
                      <div key={id} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
                          <span>{agent.emoji}</span>
                          <span className="text-sm font-medium text-gray-900">{agent.name}</span>
                          <span className="text-xs text-gray-400">{agent.role}</span>
                          {!agent.done && analyzing && <Loader2 size={12} className="animate-spin text-indigo-400 ml-auto" />}
                          {agent.done && <span className="text-xs text-green-500 ml-auto">✓</span>}
                        </div>
                        <div className="px-3 py-2 text-xs text-gray-600 leading-relaxed whitespace-pre-line max-h-32 overflow-y-auto">
                          {agent.text || <span className="text-gray-300 italic">思考中...</span>}
                        </div>
                      </div>
                    ))}

                    {/* Synthesis streaming */}
                    {synthesisText && (
                      <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 bg-indigo-100/50 border-b border-indigo-200">
                          <span>🧠</span>
                          <span className="text-sm font-medium text-indigo-900">整合者</span>
                          <span className="text-xs text-indigo-400">彙整觀點</span>
                          {analyzing && <Loader2 size={12} className="animate-spin text-indigo-400 ml-auto" />}
                        </div>
                        <div className="px-3 py-2 text-xs text-indigo-800 leading-relaxed whitespace-pre-line">
                          {synthesisText}
                        </div>
                      </div>
                    )}

                    {!analyzing && showThinking && (
                      <button
                        onClick={() => setShowThinking(false)}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        收起思考過程
                      </button>
                    )}
                  </div>
                )}

                {/* Final Reflection (always shown if available) */}
                {!analyzing && selectedEntry.ai_reflection && !showThinking && (
                  <div className="rounded-xl bg-indigo-50/60 border border-indigo-100 p-4">
                    <p className="text-sm text-indigo-900/80 leading-relaxed whitespace-pre-line">
                      {selectedEntry.ai_reflection}
                    </p>
                    {/* Collapsed agent results */}
                    {selectedEntry.ai_agents && selectedEntry.ai_agents.length > 0 && (
                      <button
                        onClick={() => setShowThinking(true)}
                        className="mt-2 text-xs text-indigo-400 hover:text-indigo-600"
                      >
                        查看 {selectedEntry.ai_agents.length} 位好友的分析過程
                      </button>
                    )}
                  </div>
                )}

                {/* Show saved agent results when expanding */}
                {!analyzing && showThinking && selectedEntry.ai_agents && selectedEntry.ai_agents.length > 0 && Object.keys(agentThinking).length === 0 && (
                  <div className="space-y-2">
                    {selectedEntry.ai_agents.map(agent => (
                      <div key={agent.agentId} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
                          <span>{agent.emoji}</span>
                          <span className="text-sm font-medium text-gray-900">{agent.name}</span>
                          <span className="text-xs text-gray-400">{agent.role}</span>
                          <span className="text-xs text-green-500 ml-auto">✓</span>
                        </div>
                        <div className="px-3 py-2 text-xs text-gray-600 leading-relaxed whitespace-pre-line">
                          {agent.result}
                        </div>
                      </div>
                    ))}
                    {selectedEntry.ai_reflection && (
                      <div className="rounded-xl bg-indigo-50/60 border border-indigo-100 p-4">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 mb-1">
                          🧠 整合回饋
                        </div>
                        <p className="text-sm text-indigo-900/80 leading-relaxed whitespace-pre-line">
                          {selectedEntry.ai_reflection}
                        </p>
                      </div>
                    )}
                    <button onClick={() => setShowThinking(false)} className="text-xs text-gray-400 hover:text-gray-600">
                      收起思考過程
                    </button>
                  </div>
                )}

                {/* Empty state */}
                {!analyzing && !selectedEntry.ai_reflection && !showThinking && (
                  <div className="rounded-xl bg-indigo-50/60 border border-indigo-100 p-4">
                    <p className="text-sm text-indigo-400 italic">
                      點擊「開始分析」讓 AI 好友團隊給你多角度的回饋
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Mobile Detail Overlay (shown on md screens when entry selected) ── */}
      {selectedEntry && !editMode && (
        <div className="fixed inset-0 z-40 bg-white flex flex-col lg:hidden">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <button
              onClick={() => setSelectedEntry(null)}
              className="flex items-center gap-1 text-sm text-gray-600"
            >
              <ChevronRight size={16} className="rotate-180" />
              返回列表
            </button>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => startEdit(selectedEntry)}
                className="p-2 text-gray-600 hover:text-indigo-600 rounded-lg transition-colors"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={handleDelete}
                className="p-2 text-gray-600 hover:text-red-600 rounded-lg transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-gray-900">{selectedEntry.title}</h3>
                {selectedEntry.mood && (
                  <span className="text-xl">{MOOD_MAP[selectedEntry.mood] ?? selectedEntry.mood}</span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">{formatDateTime(selectedEntry.created_at)}</p>
            </div>

            {selectedEntry.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedEntry.tags.map((t) => {
                  const tagObj = tags.find((x) => x.name === t);
                  return (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
                      style={
                        tagObj?.color
                          ? { backgroundColor: tagObj.color + '22', color: tagObj.color }
                          : undefined
                      }
                    >
                      <Tag size={10} />
                      {t}
                    </span>
                  );
                })}
              </div>
            )}

            <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-line">
              {selectedEntry.content}
            </div>

            {/* Mobile AI Section */}
            <div className="rounded-xl bg-indigo-50/60 border border-indigo-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-indigo-700">
                  <Sparkles size={16} />
                  AI 好友分析
                </div>
                <button
                  onClick={() => handleAnalyze()}
                  disabled={analyzing}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  {analyzing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {selectedEntry.ai_reflection ? '重新分析' : '開始分析'}
                </button>
              </div>
              {analyzing ? (
                <div className="text-xs text-indigo-500">{analysisPhase || '分析中...'}</div>
              ) : selectedEntry.ai_reflection ? (
                <p className="text-sm text-indigo-900/80 leading-relaxed whitespace-pre-line">
                  {selectedEntry.ai_reflection}
                </p>
              ) : (
                <p className="text-sm text-indigo-400 italic">
                  點擊「開始分析」讓 AI 好友團隊給你回饋
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile Edit Overlay ─────────────────────────────────── */}
      {editMode && (
        <div className="fixed inset-0 z-40 bg-white flex flex-col lg:hidden">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">
              {isNew ? '新增日記' : '編輯日記'}
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={cancelEdit}
                className="px-3 py-1.5 text-sm text-gray-600"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editTitle.trim() || !editContent.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                儲存
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">標題</label>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="為這篇日記取個標題..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">內容</label>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="寫下你的心情與想法..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-y"
                style={{ minHeight: '200px' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">心情</label>
              <div className="flex flex-wrap gap-2">
                {MOOD_ENTRIES.map(([key, emoji]) => (
                  <button
                    key={key}
                    onClick={() => setEditMood(editMood === key ? null : key)}
                    className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all ${
                      editMood === key
                        ? 'bg-indigo-100 ring-2 ring-indigo-400 scale-110'
                        : 'bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">資料夾</label>
              <select
                value={editFolderId ?? ''}
                onChange={(e) => setEditFolderId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent bg-white"
              >
                <option value="">未分類</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.icon} {f.name}
                  </option>
                ))}
              </select>
            </div>
            {!isNew && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">標籤</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {editTags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
                    >
                      {t}
                      <button onClick={() => removeTag(t)}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="輸入標籤後按 Enter"
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                  />
                  <button
                    onClick={addTag}
                    className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200"
                  >
                    新增
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
