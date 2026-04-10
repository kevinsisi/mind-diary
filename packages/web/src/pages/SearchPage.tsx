import { useState, useCallback } from 'react';
import { Search, FileText, BookOpen, Loader2, MessageCircle } from 'lucide-react';
import { apiClient } from '../api/client';

interface SearchResult {
  id: number;
  source: 'file' | 'diary' | 'chat';
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

type FilterTab = 'all' | 'diary' | 'file' | 'chat';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pagination, setPagination] = useState<SearchResponse['pagination'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [currentPage, setCurrentPage] = useState(1);

  const doSearch = useCallback(async (page: number) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setSearched(true);
    setCurrentPage(page);

    try {
      const data = await apiClient.get<SearchResponse>(
        `/api/search?q=${encodeURIComponent(trimmed)}&page=${page}&limit=20`
      );
      setResults(data.results);
      setPagination(data.pagination);
    } catch {
      setResults([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setActiveTab('all');
      doSearch(1);
    }
  };

  const handleSearchClick = () => {
    setActiveTab('all');
    doSearch(1);
  };

  const filteredResults = activeTab === 'all'
    ? results
    : results.filter((r) => r.source === activeTab);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'diary', label: '日記' },
    { key: 'file', label: '檔案' },
    { key: 'chat', label: '對話' },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Search bar */}
      <div className="flex items-center gap-3 bg-white rounded-xl shadow-md px-5 py-3 ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-indigo-400 transition-shadow">
        <Search className="w-5 h-5 text-gray-400 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜尋日記、對話、檔案..."
          className="flex-1 text-lg outline-none bg-transparent placeholder-gray-400"
        />
        <button
          onClick={handleSearchClick}
          disabled={loading || !query.trim()}
          className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          搜尋
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 mt-16 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>搜尋中...</span>
        </div>
      )}

      {/* Initial empty state */}
      {!searched && !loading && (
        <div className="flex flex-col items-center justify-center mt-24 text-gray-400">
          <Search className="w-12 h-12 mb-3" />
          <p className="text-lg">輸入關鍵字開始搜尋</p>
        </div>
      )}

      {/* Results */}
      {searched && !loading && (
        <div className="mt-6">
          {/* Result count */}
          <p className="text-sm text-gray-500 mb-3">
            找到 {results.length} 筆結果
          </p>

          {/* Filter tabs */}
          <div className="flex gap-1 mb-5 border-b border-gray-200">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* No results */}
          {filteredResults.length === 0 && (
            <div className="flex flex-col items-center justify-center mt-16 text-gray-400">
              <Search className="w-10 h-10 mb-2" />
              <p>找不到符合的結果，試試其他關鍵字</p>
            </div>
          )}

          {/* Result cards */}
          <div className="space-y-3">
            {filteredResults.map((result) => (
              <div
                key={`${result.source}-${result.id}`}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Source badge + title */}
                    <div className="flex items-center gap-2 mb-1.5">
                      {result.source === 'diary' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-700">
                          <BookOpen className="w-3 h-3" />
                          日記
                        </span>
                      ) : result.source === 'chat' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                          <MessageCircle className="w-3 h-3" />
                          對話
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
                          <FileText className="w-3 h-3" />
                          檔案
                        </span>
                      )}
                      <h3 className="font-semibold text-gray-900 truncate">{result.title}</h3>
                    </div>

                    {/* Snippet */}
                    <p
                      className="text-sm text-gray-600 line-clamp-2 [&_mark]:bg-yellow-200 [&_mark]:text-yellow-900 [&_mark]:rounded-sm [&_mark]:px-0.5"
                      dangerouslySetInnerHTML={{ __html: result.snippet }}
                    />

                    {/* Tags + date */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-xs text-gray-400">{formatDate(result.created_at)}</span>
                      {result.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => doSearch(currentPage - 1)}
                disabled={currentPage <= 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                上一頁
              </button>
              <span className="text-sm text-gray-500">
                {currentPage} / {pagination.totalPages}
              </span>
              <button
                onClick={() => doSearch(currentPage + 1)}
                disabled={currentPage >= pagination.totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                下一頁
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
