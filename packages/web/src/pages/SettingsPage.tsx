import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, Trash2, Upload, Shield, ShieldOff, BarChart3, RefreshCw } from 'lucide-react';
import { apiClient } from '../api/client';

interface ApiKey {
  id: number;
  suffix: string;
  source: string;
  isBlocked: boolean;
  inCooldown: boolean;
  cooldownReason?: string | null;
  cooldownRemaining: number;
  totalCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

interface UsageStats {
  today: { calls: number; tokens: number };
  week: { calls: number; tokens: number };
  month: { calls: number; tokens: number };
}

export default function SettingsPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [batchText, setBatchText] = useState('');
  const [showBatch, setShowBatch] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [adding, setAdding] = useState(false);

  const clearMessages = () => { setError(''); setSuccess(''); };

  const loadKeys = useCallback(async () => {
    try {
      const data = await apiClient.get<{ keys: ApiKey[] }>('/api/settings/keys');
      setKeys(data.keys || []);
    } catch {
      setError('無法載入金鑰列表');
    }
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      const data = await apiClient.get<UsageStats>('/api/settings/usage');
      setUsage(data);
    } catch { /* non-critical */ }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadKeys(), loadUsage()]);
    setLoading(false);
  }, [loadKeys, loadUsage]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleAddKey = async () => {
    clearMessages();
    const trimmed = newKey.trim();
    if (!trimmed) return;

    setAdding(true);
    try {
      await apiClient.post('/api/settings/keys', { key: trimmed });
      setSuccess(`金鑰 ...${trimmed.slice(-6)} 已新增`);
      setNewKey('');
      await loadKeys();
    } catch (err: any) {
      const body = JSON.parse(err.message || '{}');
      setError(body.error || '新增失敗');
    } finally {
      setAdding(false);
    }
  };

  const handleBatchImport = async () => {
    clearMessages();
    const lines = batchText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const validKeys = lines.filter(l => l.startsWith('AIza') && l.length >= 20);

    if (validKeys.length === 0) {
      setError('沒有偵測到有效的 Gemini 金鑰（需以 AIza 開頭）');
      return;
    }

    setAdding(true);
    try {
      const data = await apiClient.post<{ added: number; skipped: number }>('/api/settings/keys/batch', { keys: validKeys });
      setSuccess(`批次匯入完成：新增 ${data.added} 把，略過 ${data.skipped} 把`);
      setBatchText('');
      setShowBatch(false);
      await loadKeys();
    } catch (err: any) {
      const body = JSON.parse(err.message || '{}');
      setError(body.error || '批次匯入失敗');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteKey = async (suffix: string) => {
    clearMessages();
    if (!confirm(`確定要刪除金鑰 ...${suffix}？`)) return;

    try {
      await apiClient.delete(`/api/settings/keys/${suffix}`);
      setSuccess(`金鑰 ...${suffix} 已刪除`);
      await loadKeys();
    } catch (err: any) {
      const body = JSON.parse(err.message || '{}');
      setError(body.error || '刪除失敗');
    }
  };

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">設定</h2>
          <p className="mt-1 text-gray-500">管理 Gemini API 金鑰與用量統計</p>
        </div>
        <button
          onClick={loadAll}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          重新整理
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="text-green-400 hover:text-green-600">✕</button>
        </div>
      )}

      {/* Usage Stats */}
      {usage && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          {[
            { label: '今日', data: usage.today },
            { label: '7 天', data: usage.week },
            { label: '30 天', data: usage.month },
          ].map(({ label, data }) => (
            <div key={label} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                <BarChart3 className="w-4 h-4" />
                {label}
              </div>
              <div className="text-2xl font-bold text-gray-900">{data.calls} <span className="text-sm font-normal text-gray-400">次呼叫</span></div>
              <div className="text-sm text-gray-500">{formatTokens(data.tokens)} tokens</div>
            </div>
          ))}
        </div>
      )}

      {/* Add Key */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Plus className="w-5 h-5" />
          新增金鑰
        </h3>

        <div className="flex gap-2">
          <input
            type="password"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="貼上 Gemini API 金鑰（AIza...）"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
          />
          <button
            onClick={handleAddKey}
            disabled={adding || !newKey.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Key className="w-4 h-4" />
            新增
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => setShowBatch(!showBatch)}
            className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
          >
            <Upload className="w-4 h-4" />
            {showBatch ? '收起' : '批次匯入'}
          </button>
        </div>

        {showBatch && (
          <div className="mt-3">
            <textarea
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder="每行一把金鑰，自動過濾非 AIza 開頭的行..."
              rows={5}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                偵測到 {batchText.split(/\r?\n/).filter(l => l.trim().startsWith('AIza') && l.trim().length >= 20).length} 把有效金鑰
              </span>
              <button
                onClick={handleBatchImport}
                disabled={adding}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
              >
                匯入
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Key List */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Key className="w-5 h-5" />
            金鑰列表
          </h3>
          <span className="text-sm text-gray-500">{keys.length} 把金鑰</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">載入中...</div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center">
            <Key className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">尚未新增任何金鑰</p>
            <p className="text-sm text-gray-400 mt-1">在上方貼上你的 Gemini API 金鑰開始使用</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {keys.map((k) => (
              <div key={k.suffix} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${k.isBlocked ? 'bg-red-400' : k.inCooldown ? 'bg-yellow-400' : 'bg-green-400'}`} />
                  <div>
                    <div className="font-mono text-sm text-gray-900">
                      ...{k.suffix}
                      {k.source === 'env' && (
                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">ENV</span>
                      )}
                      {k.isBlocked && (
                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded">已封鎖</span>
                      )}
                      {k.inCooldown && !k.isBlocked && (
                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded">冷卻中 ({k.cooldownReason})</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      累計 {k.totalCalls} 次 · {formatTokens(k.totalTokensIn + k.totalTokensOut)} tokens
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleDeleteKey(k.suffix)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title={k.source === 'env' ? '封鎖此 ENV 金鑰' : '刪除此金鑰'}
                >
                  {k.source === 'env' ? <ShieldOff className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Help */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg text-sm text-gray-500">
        <p className="font-medium text-gray-700 mb-1">💡 提示</p>
        <ul className="list-disc list-inside space-y-1">
          <li>前往 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Google AI Studio</a> 取得免費的 Gemini API 金鑰</li>
          <li>多把金鑰可以分散 rate limit，提高穩定性</li>
          <li>ENV 來源的金鑰無法刪除，只能封鎖</li>
          <li>金鑰遇到錯誤會自動冷卻（429→2分鐘、401/403→30分鐘）</li>
        </ul>
      </div>
    </div>
  );
}
