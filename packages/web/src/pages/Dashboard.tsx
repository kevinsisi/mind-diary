import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Search, MessageCircle, Sparkles, Tag, BarChart3, Loader2, FileText } from 'lucide-react';
import { apiClient } from '../api/client';

interface RecentEntry {
  id: number;
  title: string;
  content: string;
  mood: string | null;
  tags: string[];
  ai_reflection: string | null;
  created_at: string;
}

interface TagItem {
  id: number;
  name: string;
  color: string;
  count: number;
}

interface UsageStats {
  today: { calls: number; tokens_in: number; tokens_out: number };
  last7d: { calls: number; tokens_in: number; tokens_out: number };
  last30d: { calls: number; tokens_in: number; tokens_out: number };
}

interface SearchResult {
  id: number;
  source: 'file' | 'diary';
  title: string;
  snippet: string;
  created_at: string;
  rank: number;
  tags?: string[];
}

interface SearchResponse {
  results: SearchResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const MOOD_MAP: Record<string, string> = {
  happy: '😊', sad: '😢', angry: '😡', calm: '😌', thinking: '🤔', love: '😍', strong: '💪', tired: '😴',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [totalEntries, setTotalEntries] = useState(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiClient.get<{ entries: RecentEntry[]; pagination: { total: number } }>('/api/diary?limit=5')
      .then(res => { setEntries(res.entries || []); setTotalEntries(res.pagination.total); })
      .catch(() => {});
    apiClient.get<{ tags: TagItem[] }>('/api/tags')
      .then(res => setTags((res.tags || []).slice(0, 10)))
      .catch(() => {});
    apiClient.get<UsageStats>('/api/settings/usage')
      .then(res => setUsage(res))
      .catch(() => {});
  }, []);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearchResults([]);
      setHasSearched(false);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    setHasSearched(true);

    try {
      const data = await apiClient.get<SearchResponse>(
        `/api/search?q=${encodeURIComponent(trimmed)}&page=1&limit=10`
      );
      setSearchResults(data.results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    debounceRef.current = setTimeout(() => {
      doSearch(value);
    }, 300);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      doSearch(searchQuery);
    }
  };

  const isSearchActive = searchQuery.trim().length > 0;

  return (
    <div className="max-w-4xl">
      {/* Search Bar — top of page */}
      <div className="mb-6">
        <div className="flex items-center gap-3 bg-white rounded-xl shadow-md px-5 py-3.5 ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-indigo-400 transition-shadow">
          <Search className="w-5 h-5 text-gray-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="搜尋日記、對話、標籤..."
            className="flex-1 text-lg outline-none bg-transparent placeholder-gray-400"
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="text-gray-400 hover:text-gray-600 text-sm px-2"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* Inline Search Results */}
      {isSearchActive && (
        <div className="mb-6">
          {searchLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>搜尋中...</span>
            </div>
          )}

          {hasSearched && !searchLoading && searchResults.length === 0 && (
            <div className="flex flex-col items-center py-8 text-gray-400">
              <Search className="w-8 h-8 mb-2" />
              <p className="text-sm">找不到符合的結果，試試其他關鍵字</p>
            </div>
          )}

          {!searchLoading && searchResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 mb-2">找到 {searchResults.length} 筆結果</p>
              {searchResults.map((result) => (
                <button
                  key={`${result.source}-${result.id}`}
                  onClick={() => {
                    if (result.source === 'diary') navigate('/diary');
                    else navigate('/files');
                  }}
                  className="w-full text-left bg-white rounded-lg border border-gray-200 p-3.5 hover:shadow-md hover:border-indigo-200 transition-all"
                >
                  <div className="flex items-center gap-2 mb-1">
                    {result.source === 'diary' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-indigo-100 text-indigo-700">
                        <BookOpen className="w-3 h-3" />
                        日記
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-100 text-emerald-700">
                        <FileText className="w-3 h-3" />
                        檔案
                      </span>
                    )}
                    <span className="text-sm font-medium text-gray-900 truncate">{result.title}</span>
                    <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0">{formatDate(result.created_at)}</span>
                  </div>
                  <p
                    className="text-xs text-gray-500 line-clamp-2 [&_mark]:bg-yellow-200 [&_mark]:text-yellow-900 [&_mark]:rounded-sm [&_mark]:px-0.5"
                    dangerouslySetInnerHTML={{ __html: result.snippet }}
                  />
                  {result.tags && result.tags.length > 0 && (
                    <div className="flex gap-1 mt-1.5">
                      {result.tags.slice(0, 4).map(t => (
                        <span key={t} className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Two Big Buttons — 日記 and 對話 */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <button
          onClick={() => navigate('/diary')}
          className="flex flex-col items-center justify-center gap-3 p-6 bg-gradient-to-br from-indigo-50 to-indigo-100 hover:from-indigo-100 hover:to-indigo-200 border border-indigo-200 rounded-2xl transition-all group shadow-sm hover:shadow-md"
        >
          <BookOpen className="w-10 h-10 text-indigo-600 group-hover:scale-110 transition-transform" />
          <span className="text-lg font-semibold text-indigo-700">日記</span>
          <span className="text-xs text-indigo-400">寫下你的想法</span>
        </button>
        <button
          onClick={() => navigate('/chat')}
          className="flex flex-col items-center justify-center gap-3 p-6 bg-gradient-to-br from-emerald-50 to-emerald-100 hover:from-emerald-100 hover:to-emerald-200 border border-emerald-200 rounded-2xl transition-all group shadow-sm hover:shadow-md"
        >
          <MessageCircle className="w-10 h-10 text-emerald-600 group-hover:scale-110 transition-transform" />
          <span className="text-lg font-semibold text-emerald-700">對話</span>
          <span className="text-xs text-emerald-400">和 AI 好友聊天</span>
        </button>
      </div>

      {/* Stats Row — compact */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-xs text-gray-500 mb-0.5">日記總數</div>
          <div className="text-xl font-bold text-gray-900">{totalEntries}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-xs text-gray-500 mb-0.5">標籤數</div>
          <div className="text-xl font-bold text-gray-900">{tags.length}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
            <BarChart3 className="w-3 h-3" />
            AI（7天）
          </div>
          <div className="text-xl font-bold text-gray-900">{usage?.last7d.calls || 0} <span className="text-xs font-normal text-gray-400">次</span></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Entries */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              最近日記
            </h2>
            <button onClick={() => navigate('/diary')} className="text-xs text-indigo-600 hover:text-indigo-800">
              查看全部
            </button>
          </div>
          {entries.length === 0 ? (
            <div className="p-6 text-center">
              <BookOpen className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">還沒有日記</p>
              <button
                onClick={() => navigate('/diary')}
                className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
              >
                寫第一篇日記 →
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {entries.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => navigate('/diary')}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    {entry.mood && <span className="text-sm">{MOOD_MAP[entry.mood] || ''}</span>}
                    <span className="text-sm font-medium text-gray-900 truncate">{entry.title}</span>
                    <span className="text-xs text-gray-400 ml-auto flex-shrink-0">{timeAgo(entry.created_at)}</span>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-1">{entry.content}</p>
                  {entry.tags.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {entry.tags.slice(0, 3).map(t => (
                        <span key={t} className="px-1.5 py-0.5 text-[10px] bg-indigo-50 text-indigo-600 rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {entry.ai_reflection && (
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-indigo-400">
                      <Sparkles className="w-3 h-3" />
                      AI 已分析
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tags + AI Friends */}
        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Tag className="w-4 h-4" />
              熱門標籤
            </h2>
          </div>
          {tags.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-400">
              寫日記後 AI 會自動產生標籤
            </div>
          ) : (
            <div className="p-3 flex flex-wrap gap-1.5">
              {tags.map(tag => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 text-xs rounded-full font-medium"
                  style={{ backgroundColor: tag.color + '20', color: tag.color }}
                >
                  {tag.name} <span className="opacity-60">({tag.count})</span>
                </span>
              ))}
            </div>
          )}

          {/* AI Friends */}
          <div className="px-4 py-3 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-700 mb-2">AI 好友團隊</h3>
            <div className="space-y-1.5">
              {[
                { emoji: '💜', name: '小語', role: '心靈夥伴' },
                { emoji: '🧭', name: '阿哲', role: '人生導師' },
                { emoji: '✨', name: '小星', role: '玄學顧問' },
                { emoji: '💕', name: '心心', role: '感情顧問' },
                { emoji: '🏥', name: 'Dr.安', role: '健康顧問' },
              ].map(agent => (
                <div key={agent.name} className="flex items-center gap-2 text-xs">
                  <span>{agent.emoji}</span>
                  <span className="font-medium text-gray-700">{agent.name}</span>
                  <span className="text-gray-400">{agent.role}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
