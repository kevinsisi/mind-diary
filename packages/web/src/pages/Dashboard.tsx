import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Search, MessageCircle, Plus, Sparkles, Tag, BarChart3 } from 'lucide-react';
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

export default function Dashboard() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [totalEntries, setTotalEntries] = useState(0);

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

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">心靈日記</h1>
        <p className="mt-1 text-gray-500">你的私人 AI 知識庫 — 記錄想法，讓 AI 好友團隊陪你思考</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <button
          onClick={() => navigate('/diary')}
          className="flex flex-col items-center gap-2 p-4 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors group"
        >
          <Plus className="w-6 h-6 text-indigo-600 group-hover:scale-110 transition-transform" />
          <span className="text-sm font-medium text-indigo-700">寫日記</span>
        </button>
        <button
          onClick={() => navigate('/search')}
          className="flex flex-col items-center gap-2 p-4 bg-purple-50 hover:bg-purple-100 rounded-xl transition-colors group"
        >
          <Search className="w-6 h-6 text-purple-600 group-hover:scale-110 transition-transform" />
          <span className="text-sm font-medium text-purple-700">搜尋</span>
        </button>
        <button
          onClick={() => navigate('/chat')}
          className="flex flex-col items-center gap-2 p-4 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-colors group"
        >
          <MessageCircle className="w-6 h-6 text-emerald-600 group-hover:scale-110 transition-transform" />
          <span className="text-sm font-medium text-emerald-700">AI 對話</span>
        </button>
        <button
          onClick={() => navigate('/files')}
          className="flex flex-col items-center gap-2 p-4 bg-amber-50 hover:bg-amber-100 rounded-xl transition-colors group"
        >
          <BookOpen className="w-6 h-6 text-amber-600 group-hover:scale-110 transition-transform" />
          <span className="text-sm font-medium text-amber-700">檔案</span>
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm text-gray-500 mb-1">日記總數</div>
          <div className="text-2xl font-bold text-gray-900">{totalEntries}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm text-gray-500 mb-1">標籤數</div>
          <div className="text-2xl font-bold text-gray-900">{tags.length}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-1 text-sm text-gray-500 mb-1">
            <BarChart3 className="w-3.5 h-3.5" />
            AI 用量（7天）
          </div>
          <div className="text-2xl font-bold text-gray-900">{usage?.last7d.calls || 0} <span className="text-sm font-normal text-gray-400">次</span></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Entries */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              最近日記
            </h2>
            <button onClick={() => navigate('/diary')} className="text-xs text-indigo-600 hover:text-indigo-800">
              查看全部
            </button>
          </div>
          {entries.length === 0 ? (
            <div className="p-8 text-center">
              <BookOpen className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">還沒有日記</p>
              <button
                onClick={() => navigate('/diary')}
                className="mt-3 text-sm text-indigo-600 hover:text-indigo-800"
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
                  className="w-full text-left px-5 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    {entry.mood && <span className="text-sm">{MOOD_MAP[entry.mood] || ''}</span>}
                    <span className="text-sm font-medium text-gray-900 truncate">{entry.title}</span>
                    <span className="text-xs text-gray-400 ml-auto flex-shrink-0">{timeAgo(entry.created_at)}</span>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-1">{entry.content}</p>
                  {entry.tags.length > 0 && (
                    <div className="flex gap-1 mt-1.5">
                      {entry.tags.slice(0, 3).map(t => (
                        <span key={t} className="px-1.5 py-0.5 text-[10px] bg-indigo-50 text-indigo-600 rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {entry.ai_reflection && (
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-indigo-400">
                      <Sparkles className="w-3 h-3" />
                      AI 已分析
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tags Cloud */}
        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Tag className="w-4 h-4" />
              熱門標籤
            </h2>
          </div>
          {tags.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              寫日記後 AI 會自動產生標籤
            </div>
          ) : (
            <div className="p-4 flex flex-wrap gap-2">
              {tags.map(tag => (
                <span
                  key={tag.id}
                  className="px-2.5 py-1 text-xs rounded-full font-medium"
                  style={{ backgroundColor: tag.color + '20', color: tag.color }}
                >
                  {tag.name} <span className="opacity-60">({tag.count})</span>
                </span>
              ))}
            </div>
          )}

          {/* AI Friends */}
          <div className="px-5 py-4 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">AI 好友團隊</h3>
            <div className="space-y-2">
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
