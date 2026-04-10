import { useState, useEffect, useCallback, useRef } from 'react';
import { Key, Plus, Trash2, Upload, ShieldOff, BarChart3, RefreshCw, Globe, User } from 'lucide-react';
import { apiClient } from '../api/client';
import { useSiteConfig } from '../context/SiteConfigContext';
import { useAuth } from '../context/AuthContext';

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

interface UsagePeriod {
  calls: number;
  tokens_in: number;
  tokens_out: number;
}

interface UsageStats {
  today: UsagePeriod;
  last7d: UsagePeriod;
  last30d: UsagePeriod;
}

interface UserMemory {
  id: number;
  kind: 'preference' | 'goal' | 'background' | 'relationship' | 'ongoing';
  summary: string;
  confidence: number;
  updated_at: string;
}

function isImeConfirming(e: React.KeyboardEvent<HTMLElement>) {
  const nativeEvent = e.nativeEvent as KeyboardEvent;
  return nativeEvent.isComposing || nativeEvent.keyCode === 229;
}

export default function SettingsPage() {
  const { siteTitle, updateSiteTitle } = useSiteConfig();
  const { user, updateNickname, updateCustomInstructions } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [titleInput, setTitleInput] = useState(siteTitle);
  const [titleSaving, setTitleSaving] = useState(false);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [batchText, setBatchText] = useState('');
  const [showBatch, setShowBatch] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [adding, setAdding] = useState(false);
  const [nicknameInput, setNicknameInput] = useState(user?.nickname || '');
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [customInstructions, setCustomInstructions] = useState('');
  const [instructionsSaved, setInstructionsSaved] = useState(false);
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(true);
  const [deletingMemoryId, setDeletingMemoryId] = useState<number | null>(null);
  const isComposingRef = useRef(false);

  // Sync nickname input when user loads
  useEffect(() => {
    setNicknameInput(user?.nickname || '');
    if (user?.custom_instructions !== undefined) setCustomInstructions(user.custom_instructions);
  }, [user?.nickname, user?.custom_instructions]);

  // Sync input when context loads the persisted title
  useEffect(() => { setTitleInput(siteTitle); }, [siteTitle]);

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

  const loadMemories = useCallback(async () => {
    try {
      const data = await apiClient.get<{ memories: UserMemory[] }>('/api/settings/memories');
      setMemories(data.memories || []);
    } catch {
      setError('無法載入記憶列表');
    } finally {
      setMemoriesLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setMemoriesLoading(true);
    const tasks: Promise<unknown>[] = [loadMemories()];
    if (isAdmin) {
      tasks.push(loadKeys(), loadUsage());
    }
    await Promise.all(tasks);
    setLoading(false);
  }, [isAdmin, loadKeys, loadMemories, loadUsage]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleSaveNickname = async () => {
    setNicknameSaving(true);
    clearMessages();
    try {
      await updateNickname(nicknameInput.trim());
      setSuccess('暱稱已更新');
    } catch {
      setError('儲存暱稱失敗');
    } finally {
      setNicknameSaving(false);
    }
  };

  async function handleInstructionsSave() {
    try {
      await updateCustomInstructions(customInstructions);
      setInstructionsSaved(true);
      setTimeout(() => setInstructionsSaved(false), 2000);
    } catch {
      // silent
    }
  }

  const handleDeleteMemory = async (memory: UserMemory) => {
    clearMessages();
    setDeletingMemoryId(memory.id);
    try {
      await apiClient.delete(`/api/settings/memories/${memory.id}`);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setSuccess('已刪除這則記憶');
    } catch {
      setError('刪除記憶失敗');
    } finally {
      setDeletingMemoryId(null);
    }
  };

  const handleSaveTitle = async () => {
    const trimmed = titleInput.trim();
    if (!trimmed || trimmed === siteTitle) return;
    setTitleSaving(true);
    clearMessages();
    try {
      await updateSiteTitle(trimmed);
      setSuccess('網站標題已更新');
    } catch {
      setError('儲存標題失敗');
    } finally {
      setTitleSaving(false);
    }
  };

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

  const memoryKindLabels: Record<UserMemory['kind'], string> = {
    preference: '偏好',
    goal: '目標',
    background: '背景',
    relationship: '關係',
    ongoing: '持續狀態',
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">設定</h2>
          <p className="mt-1 text-gray-500 dark:text-gray-400">{isAdmin ? '管理 Gemini API 金鑰與用量統計' : '個人設定'}</p>
        </div>
        {isAdmin && (
          <button
            onClick={loadAll}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <RefreshCw className="w-4 h-4" />
            重新整理
          </button>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-lg flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="text-green-400 hover:text-green-600">✕</button>
        </div>
      )}

      {/* Nickname */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-5 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <User className="w-5 h-5" />
          暱稱
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            placeholder="輸入你的暱稱（最多 30 字）"
            maxLength={30}
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isComposingRef.current && !isImeConfirming(e)) handleSaveNickname();
            }}
          />
          <button
            onClick={handleSaveNickname}
            disabled={nicknameSaving || nicknameInput.trim() === (user?.nickname || '')}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {nicknameSaving ? '儲存中…' : '儲存'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">設定後，AI 好友們會用你的暱稱稱呼你</p>
      </div>

      {/* Custom Instructions */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">自訂指示</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          告訴 AI 夥伴你的偏好、背景或希望它注意的事項（最多 500 字）
        </p>
        <textarea
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          maxLength={500}
          rows={4}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          placeholder="例如：我喜歡簡短的回覆、我正在學習程式設計、請用鼓勵的語氣回應我..."
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-400 dark:text-gray-600">{customInstructions.length}/500</span>
          <button
            onClick={handleInstructionsSave}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
          >
            {instructionsSaved ? '已儲存 ✓' : '儲存'}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-5 mb-6">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">跨對話記憶</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">AI 會記住對未來對話有幫助的偏好、背景或長期目標。你可以刪除不想保留的內容。</p>
          </div>
          <span className="text-sm text-gray-500 dark:text-gray-400">{memories.length} 則</span>
        </div>

        {memoriesLoading ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 py-4">載入中...</div>
        ) : memories.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
            目前還沒有保存任何跨對話記憶。
          </div>
        ) : (
          <div className="space-y-3">
            {memories.map((memory) => (
              <div key={memory.id} className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300">{memoryKindLabels[memory.kind]}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">可信度 {memory.confidence}</span>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-gray-100">{memory.summary}</p>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">更新於 {new Date(memory.updated_at).toLocaleString('zh-TW')}</p>
                </div>
                <button
                  onClick={() => handleDeleteMemory(memory)}
                  disabled={deletingMemoryId === memory.id}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="刪除此記憶"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage Stats */}
      {isAdmin && usage && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          {[
            { label: '今日', data: usage.today },
            { label: '7 天', data: usage.last7d },
            { label: '30 天', data: usage.last30d },
          ].map(({ label, data }) => (
            <div key={label} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
                <BarChart3 className="w-4 h-4" />
                {label}
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.calls} <span className="text-sm font-normal text-gray-400 dark:text-gray-500">次呼叫</span></div>
              <div className="text-sm text-gray-500 dark:text-gray-400">{formatTokens(data.tokens_in + data.tokens_out)} tokens</div>
            </div>
          ))}
        </div>
      )}

      {/* Admin-only sections */}
      {isAdmin && <>

      {/* Site Title */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-5 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <Globe className="w-5 h-5" />
          網站標題
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            placeholder="輸入網站標題"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isComposingRef.current && !isImeConfirming(e)) handleSaveTitle();
            }}
          />
          <button
            onClick={handleSaveTitle}
            disabled={titleSaving || !titleInput.trim() || titleInput.trim() === siteTitle}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {titleSaving ? '儲存中…' : '儲存'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">修改後會即時反映在側邊欄、瀏覽器 tab 標題及登入頁面</p>
      </div>

      {/* Add Key */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-5 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <Plus className="w-5 h-5" />
          新增金鑰
        </h3>

        <div className="flex gap-2">
          <input
            type="password"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            placeholder="貼上 Gemini API 金鑰（AIza...）"
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isComposingRef.current && !isImeConfirming(e)) handleAddKey();
            }}
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
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-gray-400 dark:text-gray-500">
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
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Key className="w-5 h-5" />
            金鑰列表
          </h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">{keys.length} 把金鑰</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">載入中...</div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center">
            <Key className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400">尚未新增任何金鑰</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">在上方貼上你的 Gemini API 金鑰開始使用</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {keys.map((k) => (
              <div key={k.suffix} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${k.isBlocked ? 'bg-red-400' : k.inCooldown ? 'bg-yellow-400' : 'bg-green-400'}`} />
                  <div>
                    <div className="font-mono text-sm text-gray-900 dark:text-gray-100">
                      ...{k.suffix}
                      {k.source === 'env' && (
                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded">ENV</span>
                      )}
                      {k.isBlocked && (
                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded">已封鎖</span>
                      )}
                      {k.inCooldown && !k.isBlocked && (
                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded">冷卻中 ({k.cooldownReason})</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
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
      <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm text-gray-500 dark:text-gray-400">
        <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">💡 提示</p>
        <ul className="list-disc list-inside space-y-1">
          <li>前往 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Google AI Studio</a> 取得免費的 Gemini API 金鑰</li>
          <li>多把金鑰可以分散 rate limit，提高穩定性</li>
          <li>ENV 來源的金鑰無法刪除，只能封鎖</li>
          <li>金鑰遇到錯誤會自動冷卻（429→2分鐘、401/403→30分鐘）</li>
        </ul>
      </div>

      </>}
    </div>
  );
}
