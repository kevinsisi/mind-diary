import { useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import {
  Home,
  FileText,
  BookOpen,
  MessageCircle,
  Search,
  Settings,
  Menu,
  X,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Files from './pages/Files';
import Diary from './pages/Diary';
import Chat from './pages/Chat';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';

const navItems = [
  { to: '/', label: '首頁', icon: Home },
  { to: '/files', label: '檔案', icon: FileText },
  { to: '/diary', label: '日記', icon: BookOpen },
  { to: '/chat', label: '對話', icon: MessageCircle },
  { to: '/search', label: '搜尋', icon: Search },
  { to: '/settings', label: '設定', icon: Settings },
];

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
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
          fixed inset-y-0 left-0 z-30 w-60 bg-white border-r border-gray-200
          transform transition-transform duration-200 ease-in-out
          lg:relative lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-indigo-600">心靈日記</h1>
          <button
            className="lg:hidden p-1 rounded hover:bg-gray-100"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="p-3 space-y-1">
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
          <h1 className="ml-3 text-lg font-bold text-indigo-600">心靈日記</h1>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/files" element={<Files />} />
            <Route path="/diary" element={<Diary />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
