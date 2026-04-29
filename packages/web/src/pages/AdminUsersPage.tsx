import { useEffect, useState, FormEvent } from 'react';
import { Loader2, Plus, Trash2, KeyRound, ShieldCheck, User } from 'lucide-react';
import { apiClient } from '../api/client';

interface UserRecord {
  id: number;
  username: string;
  role: 'admin' | 'user';
  created_at: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // New user form
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [creating, setCreating] = useState(false);

  // Reset password dialog
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  async function loadUsers() {
    try {
      const data = await apiClient.get<UserRecord[]>('/api/auth/users');
      setUsers(data);
    } catch {
      setError('無法載入使用者清單');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function notify(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 3000);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await apiClient.post('/api/auth/users', { username: newUsername, password: newPassword, role: newRole });
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      notify('使用者已建立');
      await loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg.includes('409') || msg.toLowerCase().includes('exist') ? '使用者名稱已存在' : '建立失敗');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(user: UserRecord) {
    if (!confirm(`確定要刪除使用者「${user.username}」？此操作無法復原。`)) return;
    setError('');
    try {
      await apiClient.delete(`/api/auth/users/${user.id}`);
      notify('使用者已刪除');
      await loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg.includes('400') || msg.includes('最後') ? '無法刪除最後一個管理員帳號' : '刪除失敗');
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setError('');
    setResetting(true);
    try {
      await apiClient.post('/api/auth/reset-password', {
        username: resetTarget.username,
        newPassword: resetPassword,
      });
      setResetTarget(null);
      setResetPassword('');
      notify('密碼已重設');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg.includes('長度') ? '新密碼長度至少 4 個字元' : '重設密碼失敗');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">使用者管理</h1>
        <p className="text-sm text-gray-500 mt-1">新增、刪除使用者或重設密碼</p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">{success}</div>
      )}

      {/* User list */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 font-medium text-gray-800">現有使用者</div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-indigo-500" size={24} />
          </div>
        ) : users.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">尚無使用者</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                  {u.role === 'admin' ? (
                    <ShieldCheck size={16} className="text-indigo-600" />
                  ) : (
                    <User size={16} className="text-indigo-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-900">{u.username}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        u.role === 'admin'
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {u.role === 'admin' ? '管理員' : '使用者'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    建立於 {new Date(u.created_at).toLocaleDateString('zh-TW')}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { setResetTarget(u); setResetPassword(''); }}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition-colors"
                    title="重設密碼"
                  >
                    <KeyRound size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(u)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600 transition-colors"
                    title="刪除使用者"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Create user form */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
          <Plus size={18} className="text-indigo-500" />
          新增使用者
        </h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">使用者名稱</label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
                placeholder="輸入使用者名稱"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密碼</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                placeholder="輸入初始密碼"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="user">使用者</option>
              <option value="admin">管理員</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {creating && <Loader2 size={14} className="animate-spin" />}
            {creating ? '建立中…' : '建立使用者'}
          </button>
        </form>
      </div>

      {/* Reset password dialog */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="font-semibold text-gray-900 mb-1">重設密碼</h3>
            <p className="text-sm text-gray-500 mb-5">
              為「<strong>{resetTarget.username}</strong>」設定新密碼
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">新密碼</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  required
                  autoFocus
                  placeholder="輸入新密碼"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={resetting}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  {resetting && <Loader2 size={14} className="animate-spin" />}
                  {resetting ? '重設中…' : '確認重設'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
