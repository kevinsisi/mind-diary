import { useEffect, useMemo, useState } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import {
  Home,
  FileText,
  BookOpen,
  MessageCircle,
  Search,
  Settings,
  Menu,
  X,
  LogIn,
  LogOut,
  Users,
  UserCircle,
  Moon,
  Sun,
} from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { useSiteConfig } from './context/SiteConfigContext';
import { useTheme } from './context/ThemeContext';
import PrivateRoute from './components/PrivateRoute';
import Dashboard from './pages/Dashboard';
import Files from './pages/Files';
import Diary from './pages/Diary';
import Chat from './pages/Chat';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import AdminUsersPage from './pages/AdminUsersPage';
import { APP_VERSION, LAST_SEEN_VERSION_KEY, RELEASE_NOTES } from './version';

const navItems = [
  { to: '/', label: '首頁', icon: Home },
  { to: '/files', label: '檔案', icon: FileText },
  { to: '/diary', label: '日記', icon: BookOpen },
  { to: '/chat', label: '對話', icon: MessageCircle },
  { to: '/search', label: '搜尋', icon: Search },
  { to: '/settings', label: '設定', icon: Settings },
];

function SidebarFooter() {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="p-3 border-t border-gray-200 dark:border-gray-700 space-y-1">
      <button
        onClick={toggleTheme}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        title={isDark ? '切換淺色模式' : '切換深色模式'}
      >
        {isDark ? <Sun size={18} /> : <Moon size={18} />}
        {isDark ? '淺色模式' : '深色模式'}
      </button>

      {user ? (
        <>
          {user.role === 'admin' && (
            <NavLink
              to="/admin/users"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
                }`
              }
            >
              <Users size={18} />
              使用者管理
            </NavLink>
          )}
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
            <UserCircle size={18} />
            <span className="flex-1 truncate font-medium">{user.username}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
              {user.role === 'admin' ? '管理員' : '使用者'}
            </span>
          </div>
          <button
            onClick={async () => {
              await logout();
              navigate('/');
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            <LogOut size={18} />
            登出
          </button>
        </>
      ) : (
        <>
          <div className="px-3 py-1.5 mb-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            訪客模式 — 瀏覽公共空間
          </div>
          <NavLink
            to="/login"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            <LogIn size={18} />
            登入
          </NavLink>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [releaseNotes, setReleaseNotes] = useState<typeof RELEASE_NOTES>([]);
  const { siteTitle } = useSiteConfig();

  const currentVersionIndex = useMemo(
    () => RELEASE_NOTES.findIndex((note) => note.version === APP_VERSION),
    []
  );

  useEffect(() => {
    const lastSeenVersion = localStorage.getItem(LAST_SEEN_VERSION_KEY);
    if (lastSeenVersion === APP_VERSION) return;

    const lastSeenIndex = RELEASE_NOTES.findIndex((note) => note.version === lastSeenVersion);
    const notesToShow = RELEASE_NOTES.filter((_, index) => {
      if (currentVersionIndex === -1) return false;
      if (lastSeenIndex === -1) return index <= currentVersionIndex;
      return index <= currentVersionIndex && index < lastSeenIndex;
    });

    if (notesToShow.length > 0) {
      setReleaseNotes(notesToShow);
      setShowReleaseNotes(true);
    }
  }, [currentVersionIndex]);

  const dismissReleaseNotes = () => {
    localStorage.setItem(LAST_SEEN_VERSION_KEY, APP_VERSION);
    setShowReleaseNotes(false);
  };

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="*"
        element={
          <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-950">
            {showReleaseNotes && (
              <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <p className="text-sm text-indigo-600 dark:text-indigo-400 font-medium">v{APP_VERSION}</p>
                      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-1">在你不在的時候，我們加入了這些功能</h2>
                    </div>
                    <button
                      onClick={dismissReleaseNotes}
                      className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                      aria-label="關閉更新提示"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                    {releaseNotes.map((note) => (
                      <div key={note.version} className="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">v{note.version}</span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">{note.title}</span>
                        </div>
                        <ul className="space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
                          {note.highlights.map((highlight) => (
                            <li key={highlight}>• {highlight}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex justify-end">
                    <button
                      onClick={dismissReleaseNotes}
                      className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                    >
                      我知道了
                    </button>
                  </div>
                </div>
              </div>
            )}

            {sidebarOpen && (
              <div
                className="fixed inset-0 z-20 bg-black/30 lg:hidden"
                onClick={() => setSidebarOpen(false)}
              />
            )}

            <aside
              className={`
                fixed inset-y-0 left-0 z-30 w-60 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col
                transform transition-transform duration-200 ease-in-out
                lg:relative lg:translate-x-0
                ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
              `}
            >
              <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
                <h1 className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{siteTitle}</h1>
                <button
                  className="lg:hidden p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
                  onClick={() => setSidebarOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>
              <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
                {navItems.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
                      }`
                    }
                  >
                    <Icon size={18} />
                    {label}
                  </NavLink>
                ))}
              </nav>
              <SidebarFooter />
            </aside>

            <div className="flex-1 flex flex-col min-w-0">
              <header className="flex items-center h-16 px-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 lg:hidden">
                <button
                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu size={22} />
                </button>
                <h1 className="ml-3 text-lg font-bold text-indigo-600 dark:text-indigo-400">{siteTitle}</h1>
              </header>

              <main className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-950">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/files" element={<Files />} />
                  <Route
                    path="/diary"
                    element={
                      <PrivateRoute>
                        <Diary />
                      </PrivateRoute>
                    }
                  />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route
                    path="/settings"
                    element={
                      <PrivateRoute>
                        <SettingsPage />
                      </PrivateRoute>
                    }
                  />
                  <Route
                    path="/admin/users"
                    element={
                      <PrivateRoute adminOnly>
                        <AdminUsersPage />
                      </PrivateRoute>
                    }
                  />
                </Routes>
              </main>
            </div>
          </div>
        }
      />
    </Routes>
  );
}
