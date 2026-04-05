import { useState } from 'react';
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
} from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { useSiteConfig } from './context/SiteConfigContext';
import PrivateRoute from './components/PrivateRoute';
import Dashboard from './pages/Dashboard';
import Files from './pages/Files';
import Diary from './pages/Diary';
import Chat from './pages/Chat';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import AdminUsersPage from './pages/AdminUsersPage';

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
  const navigate = useNavigate();

  if (user) {
    return (
      <div className="p-3 border-t border-gray-200 space-y-1">
        {user.role === 'admin' && (
          <NavLink
            to="/admin/users"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <Users size={18} />
            使用者管理
          </NavLink>
        )}
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600">
          <UserCircle size={18} />
          <span className="flex-1 truncate font-medium">{user.username}</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {user.role === 'admin' ? '管理員' : '使用者'}
          </span>
        </div>
        <button
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <LogOut size={18} />
          登出
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 border-t border-gray-200">
      <div className="px-3 py-1.5 mb-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg">
        訪客模式 — 瀏覽公共空間
      </div>
      <NavLink
        to="/login"
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      >
        <LogIn size={18} />
        登入
      </NavLink>
    </div>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { siteTitle } = useSiteConfig();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="*"
        element={
          <div className="flex h-screen overflow-hidden">
            {/* Mobile overlay */}
            {sidebarOpen && (
              <div
                className="fixed inset-0 z-20 bg-black/30 lg:hidden"
                onClick={() => setSidebarOpen(false)}
              />
            )}

            {/* Sidebar */}
            <aside
              className={`
                fixed inset-y-0 left-0 z-30 w-60 bg-white border-r border-gray-200 flex flex-col
                transform transition-transform duration-200 ease-in-out
                lg:relative lg:translate-x-0
                ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
              `}
            >
              <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 shrink-0">
                <h1 className="text-lg font-bold text-indigo-600">{siteTitle}</h1>
                <button
                  className="lg:hidden p-1 rounded hover:bg-gray-100"
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
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
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

            {/* Main content */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Top bar (mobile) */}
              <header className="flex items-center h-16 px-4 border-b border-gray-200 bg-white lg:hidden">
                <button
                  className="p-1.5 rounded hover:bg-gray-100"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu size={22} />
                </button>
                <h1 className="ml-3 text-lg font-bold text-indigo-600">{siteTitle}</h1>
              </header>

              <main className="flex-1 overflow-y-auto p-6">
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
