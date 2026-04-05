# Mind Diary — Dark Mode + Custom Instructions + Tag & Stats Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dark mode with toggle, global custom AI instructions per user, fix tags to be user-scoped, and fix usage stats for non-admin users.

**Architecture:** Dark mode uses Tailwind `darkMode: 'class'` with a ThemeContext persisted in localStorage. Custom instructions are stored in `users.custom_instructions` and injected into all AI agent system prompts alongside the existing nickname instruction. Tag and stats fixes align user-scoping across endpoints.

**Tech Stack:** React + Tailwind CSS (dark mode), SQLite ALTER TABLE (migration), Express + better-sqlite3 (API), Google Generative AI SDK (AI injection)

---

## File Map

### Created
- `packages/web/src/context/ThemeContext.tsx` — dark mode state, localStorage persistence, prefers-color-scheme default, toggle function

### Modified
- `packages/web/tailwind.config.js` — add `darkMode: 'class'`
- `packages/web/src/main.tsx` — wrap with `<ThemeProvider>`
- `packages/web/src/App.tsx` — add dark: classes to layout, add toggle button in sidebar
- `packages/web/src/pages/LoginPage.tsx` — add dark: classes
- `packages/web/src/pages/Dashboard.tsx` — add dark: classes
- `packages/web/src/pages/SettingsPage.tsx` — add dark: classes + custom instructions textarea
- `packages/web/src/pages/Diary.tsx` — add dark: classes
- `packages/web/src/pages/Chat.tsx` — add dark: classes
- `packages/web/src/context/AuthContext.tsx` — add `custom_instructions` to AuthUser type and `updateCustomInstructions` method
- `packages/server/src/db/migrate.ts` — ALTER TABLE to add `custom_instructions TEXT NOT NULL DEFAULT ''` to users
- `packages/server/src/routes/auth.ts` — GET /me returns custom_instructions; PATCH /me accepts custom_instructions (max 500 chars)
- `packages/server/src/ai/diaryAnalyzer.ts` — add `buildCustomInstructions`, thread `customInstructions` through `runAgent` → `analyzeDiary`
- `packages/server/src/routes/chat.ts` — add `buildCustomInstructions`, fetch user.custom_instructions and inject into agent system prompts
- `packages/server/src/routes/diary.ts` — fetch user.custom_instructions and pass to analyzeDiary call
- `packages/server/src/routes/tags.ts` — add requireAuth, scope query to user's diary entries
- `packages/server/src/routes/settings.ts` — change /usage from requireAdmin to requireAuth; return per-user diary AI call counts for non-admins

---

## Task 1: Dark Mode Infrastructure

**Files:**
- Modify: `packages/web/tailwind.config.js`
- Create: `packages/web/src/context/ThemeContext.tsx`
- Modify: `packages/web/src/main.tsx`

- [ ] **Step 1: Add darkMode: 'class' to Tailwind config**

`packages/web/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};
```

- [ ] **Step 2: Create ThemeContext.tsx**

`packages/web/src/context/ThemeContext.tsx`:
```tsx
import { createContext, useContext, useEffect, useState } from 'react';

interface ThemeContextType {
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({ isDark: false, toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme: () => setIsDark(d => !d) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
```

- [ ] **Step 3: Wrap app with ThemeProvider in main.tsx**

`packages/web/src/main.tsx` — add ThemeProvider import and wrap:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SiteConfigProvider } from './context/SiteConfigContext';
import { ThemeProvider } from './context/ThemeContext';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SiteConfigProvider>
        <AuthProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </AuthProvider>
      </SiteConfigProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

---

## Task 2: Dark Mode in App.tsx (Layout + Toggle)

**Files:**
- Modify: `packages/web/src/App.tsx`

The layout has: sidebar (`bg-white border-gray-200`), mobile header (`bg-white`), main content area. Add a dark mode toggle (Moon/Sun icon) in the sidebar footer area and add `dark:` classes throughout.

- [ ] **Step 1: Update App.tsx with dark: classes and toggle button**

Replace the full `packages/web/src/App.tsx` with:
```tsx
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
      {/* Dark mode toggle */}
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
              navigate('/login');
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
  const { siteTitle } = useSiteConfig();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="*"
        element={
          <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-950">
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

            {/* Main content */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Top bar (mobile) */}
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
```

---

## Task 3: Dark Mode in LoginPage, Dashboard, SettingsPage

**Files:**
- Modify: `packages/web/src/pages/LoginPage.tsx`
- Modify: `packages/web/src/pages/Dashboard.tsx`
- Modify: `packages/web/src/pages/SettingsPage.tsx`

### LoginPage.tsx

- [ ] **Step 1: Read the full LoginPage.tsx** to confirm current classes, then apply dark: variants.

Replace class strings in `packages/web/src/pages/LoginPage.tsx`:
- `min-h-screen ... bg-gray-50` → `min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950`
- `bg-indigo-100` → `bg-indigo-100 dark:bg-indigo-900/30`
- `text-gray-900` (h1) → `text-gray-900 dark:text-gray-100`
- `text-gray-500` (p) → `text-gray-500 dark:text-gray-400`
- form card: `bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-5` → add `dark:bg-gray-900 dark:border-gray-700`
- label `text-gray-700` → `text-gray-700 dark:text-gray-300`
- input `border-gray-300` → `border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500`
- footer `text-gray-400` → `text-gray-400 dark:text-gray-600`

Full updated `packages/web/src/pages/LoginPage.tsx`:
```tsx
import { FormEvent, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BookOpen, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSiteConfig } from '../context/SiteConfigContext';

export default function LoginPage() {
  const { login } = useAuth();
  const { siteTitle } = useSiteConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch {
      setError('帳號或密碼錯誤');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-900/30 mb-3">
            <BookOpen className="text-indigo-600 dark:text-indigo-400" size={28} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{siteTitle}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">請登入您的帳號</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 space-y-5">
          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">使用者名稱</label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="輸入使用者名稱"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">密碼</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="輸入密碼"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 text-sm font-medium disabled:opacity-60 transition-colors"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? '登入中…' : '登入'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 dark:text-gray-600 mt-6">
          未登入可以「訪客模式」瀏覽公共空間
        </p>
      </div>
    </div>
  );
}
```

### Dashboard.tsx and SettingsPage.tsx

- [ ] **Step 2: Read full Dashboard.tsx** (`packages/web/src/pages/Dashboard.tsx`) to get current class names.

- [ ] **Step 3: Apply dark: variants to Dashboard.tsx**

Systematic replacements in Dashboard.tsx:
- Outer wrapper `bg-white` → `bg-white dark:bg-gray-900`
- `bg-gray-50` → `bg-gray-50 dark:bg-gray-800`
- `bg-gray-100` → `bg-gray-100 dark:bg-gray-700`
- `text-gray-900` → `text-gray-900 dark:text-gray-100`
- `text-gray-700` → `text-gray-700 dark:text-gray-300`
- `text-gray-600` → `text-gray-600 dark:text-gray-400`
- `text-gray-500` → `text-gray-500 dark:text-gray-500`
- `text-gray-400` → `text-gray-400 dark:text-gray-600`
- `border-gray-200` → `border-gray-200 dark:border-gray-700`
- `border-gray-300` → `border-gray-300 dark:border-gray-600`
- stat cards: add `dark:bg-gray-800 dark:border-gray-700`
- input fields: add `dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100`

Use Edit tool with exact old→new string replacements for each occurrence. Read the file first, then apply all replacements.

- [ ] **Step 4: Read full SettingsPage.tsx** (`packages/web/src/pages/SettingsPage.tsx`) to get current class names.

- [ ] **Step 5: Apply dark: variants to SettingsPage.tsx**

Apply the same systematic replacement patterns as Dashboard above. Key elements:
- Section headers and labels
- Input fields (nickname, title, key inputs)
- Cards/panels (`bg-white`, `bg-gray-50`)
- Key list items
- Usage stat cards
- Error/success banners: `bg-red-50` → add `dark:bg-red-900/20`, same for green/yellow

---

## Task 4: Dark Mode in Diary.tsx + Chat.tsx

**Files:**
- Modify: `packages/web/src/pages/Diary.tsx`
- Modify: `packages/web/src/pages/Chat.tsx`

These are large files (1700+ and 1500+ lines). Read each one, then apply dark: class variants to all UI elements.

- [ ] **Step 1: Read Diary.tsx** — full file or in 500-line chunks.

- [ ] **Step 2: Apply dark: variants to Diary.tsx**

Focus on structural elements:
- Outer panel wrappers: `bg-white` → add `dark:bg-gray-900`
- Sidebar/list panel backgrounds: `bg-gray-50` → add `dark:bg-gray-800`
- Entry list items: add hover dark states
- Text areas and inputs: add `dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100`
- Borders: `border-gray-200` → add `dark:border-gray-700`
- Heading text: `text-gray-900` → add `dark:text-gray-100`
- Secondary text: `text-gray-600`/`text-gray-500` → add `dark:text-gray-400`
- Buttons (secondary): add `dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-300`
- AI response panel: likely has specific background — add dark variant
- Tags: add dark variants to tag badges
- Modal/overlay backgrounds: add `dark:bg-gray-800`

Apply using Edit tool with exact old→new replacements for each unique class string.

- [ ] **Step 3: Read Chat.tsx** — full file or in 500-line chunks.

- [ ] **Step 4: Apply dark: variants to Chat.tsx**

Same systematic approach as Diary.tsx. Key elements:
- Chat panel outer wrapper
- Message bubbles: user messages (indigo) keep same; AI agent bubbles add dark variants
- Input area at bottom
- Session list sidebar
- Agent selection cards
- SSE streaming text areas

---

## Task 5: Custom Instructions — DB Migration

**Files:**
- Modify: `packages/server/src/db/migrate.ts`

- [ ] **Step 1: Add custom_instructions column migration**

After the nickname migration block (currently lines ~201-205), add:

```typescript
  // Add custom_instructions column to users if it doesn't exist
  if (!userCols.some((c: any) => c.name === "custom_instructions")) {
    db.exec("ALTER TABLE users ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT ''");
  }
```

The exact insertion point: after the line `db.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");` block and before `console.log("[migrate] All tables and FTS indexes created.");`.

Current block at lines 201-205:
```typescript
  // Add nickname column to users if it doesn't exist
  const userCols = db.prepare("PRAGMA table_info(users)").all() as any[];
  if (!userCols.some((c: any) => c.name === "nickname")) {
    db.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
  }
```

Replace with:
```typescript
  // Add nickname column to users if it doesn't exist
  const userCols = db.prepare("PRAGMA table_info(users)").all() as any[];
  if (!userCols.some((c: any) => c.name === "nickname")) {
    db.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
  }

  // Add custom_instructions column to users if it doesn't exist
  if (!userCols.some((c: any) => c.name === "custom_instructions")) {
    db.exec("ALTER TABLE users ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT ''");
  }
```

**Note:** `userCols` is already fetched above so we can reuse it. However if nickname was just added in this same migration run, userCols might not reflect it. To be safe, re-fetch:

```typescript
  // Add custom_instructions column to users if it doesn't exist
  const userColsRefreshed = db.prepare("PRAGMA table_info(users)").all() as any[];
  if (!userColsRefreshed.some((c: any) => c.name === "custom_instructions")) {
    db.exec("ALTER TABLE users ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT ''");
  }
```

---

## Task 6: Custom Instructions — Auth API

**Files:**
- Modify: `packages/server/src/routes/auth.ts`

- [ ] **Step 1: Read auth.ts** (full file) to confirm exact line numbers for GET /me and PATCH /me.

- [ ] **Step 2: Update GET /me to return custom_instructions**

Find the SELECT query in GET /me handler (currently at ~line 47):
```typescript
    .prepare("SELECT id, username, role, nickname, created_at FROM users WHERE id = ?")
```

Replace with:
```typescript
    .prepare("SELECT id, username, role, nickname, custom_instructions, created_at FROM users WHERE id = ?")
```

- [ ] **Step 3: Update PATCH /me to accept custom_instructions**

Find the PATCH /me handler (lines ~57-74). Replace the handler body:

Old handler body (lines ~59-73):
```typescript
  const { nickname } = req.body as { nickname?: string };
  if (typeof nickname !== "string") {
    res.status(400).json({ error: "nickname 必須是字串" });
    return;
  }
  const trimmed = nickname.trim().slice(0, 30);
  sqlite.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(trimmed, req.userId);
  const updated = sqlite
    .prepare("SELECT id, username, role, nickname, created_at FROM users WHERE id = ?")
    .get(req.userId) as any;
  res.json(updated);
```

Replace with:
```typescript
  const { nickname, custom_instructions } = req.body as { nickname?: string; custom_instructions?: string };

  const updates: string[] = [];
  const params: any[] = [];

  if (typeof nickname === "string") {
    updates.push("nickname = ?");
    params.push(nickname.trim().slice(0, 30));
  }

  if (typeof custom_instructions === "string") {
    updates.push("custom_instructions = ?");
    params.push(custom_instructions.trim().slice(0, 500));
  }

  if (updates.length === 0) {
    res.status(400).json({ error: "沒有可更新的欄位" });
    return;
  }

  params.push(req.userId);
  sqlite.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  const updated = sqlite
    .prepare("SELECT id, username, role, nickname, custom_instructions, created_at FROM users WHERE id = ?")
    .get(req.userId) as any;
  res.json(updated);
```

---

## Task 7: Custom Instructions — AI Integration

**Files:**
- Modify: `packages/server/src/ai/diaryAnalyzer.ts`
- Modify: `packages/server/src/routes/chat.ts`
- Modify: `packages/server/src/routes/diary.ts`

### diaryAnalyzer.ts

- [ ] **Step 1: Add buildCustomInstructions function**

In `packages/server/src/ai/diaryAnalyzer.ts`, after the existing `buildNicknameInstruction` function (around line 150):

```typescript
function buildCustomInstructions(customInstructions: string): string {
  return customInstructions.trim()
    ? `使用者的自訂指示（請遵守）：\n${customInstructions.trim()}\n\n`
    : '';
}
```

- [ ] **Step 2: Add customInstructions param to runAgent**

Find the `runAgent` function signature (around line 130):
```typescript
async function runAgent(
  agent: AgentPersona,
  title: string,
  content: string,
  _apiKey: string,
  onEvent: OnEvent,
  imageContext?: string,
  nickname?: string,
): Promise<{ agentId: string; result: string }>
```

Replace with:
```typescript
async function runAgent(
  agent: AgentPersona,
  title: string,
  content: string,
  _apiKey: string,
  onEvent: OnEvent,
  imageContext?: string,
  nickname?: string,
  customInstructions?: string,
): Promise<{ agentId: string; result: string }>
```

- [ ] **Step 3: Inject customInstructions into runAgent system prompt**

Find inside runAgent where systemInstruction is built (around line 156):
```typescript
      systemInstruction: buildNicknameInstruction(nickname || '') + agent.systemPrompt,
```

Replace with:
```typescript
      systemInstruction: buildNicknameInstruction(nickname || '') + buildCustomInstructions(customInstructions || '') + agent.systemPrompt,
```

- [ ] **Step 4: Read lines 200-325 of diaryAnalyzer.ts** to find analyzeDiary function signature and where runAgent is called.

- [ ] **Step 5: Add customInstructions param to analyzeDiary and thread it through**

Find the `analyzeDiary` function signature (around line 259). Add `customInstructions?: string` parameter.

Find each `runAgent(...)` call inside analyzeDiary and add `customInstructions` as the last argument.

Find the `synthesize` function — if it also runs an AI call, it uses MASTER_AGENT_PROMPT which is a synthesizer and doesn't need custom instructions (it's internal), so leave it unchanged.

### chat.ts

- [ ] **Step 6: Add buildCustomInstructions to chat.ts**

In `packages/server/src/routes/chat.ts`, after the existing `buildNicknameInstruction` function (around line 43):

```typescript
function buildCustomInstructions(customInstructions: string): string {
  return customInstructions.trim()
    ? `使用者的自訂指示（請遵守）：\n${customInstructions.trim()}\n\n`
    : '';
}
```

- [ ] **Step 7: Read chat.ts lines 40-120** to find where runChatAgent builds its system prompt and where user nickname is fetched.

- [ ] **Step 8: Add customInstructions param to runChatAgent**

Find the `runChatAgent` function signature (around line 44):
```typescript
async function runChatAgent(
  agent: AgentPersona,
  userMessage: string,
  contextStr: string,
  historyStr: string,
  _apiKey: string,
  onEvent: (event: Record<string, any>) => void,
  imagePart?: string,
  nickname?: string,
): Promise<{ agentId: string; result: string }>
```

Replace with:
```typescript
async function runChatAgent(
  agent: AgentPersona,
  userMessage: string,
  contextStr: string,
  historyStr: string,
  _apiKey: string,
  onEvent: (event: Record<string, any>) => void,
  imagePart?: string,
  nickname?: string,
  customInstructions?: string,
): Promise<{ agentId: string; result: string }>
```

- [ ] **Step 9: Inject customInstructions into runChatAgent system prompt**

Find in runChatAgent where `chatSystemPrompt` is built (around line 44):
```typescript
  const chatSystemPrompt = `${buildNicknameInstruction(nickname || '')}你是「${agent.name}」...
```

Replace with:
```typescript
  const chatSystemPrompt = `${buildNicknameInstruction(nickname || '')}${buildCustomInstructions(customInstructions || '')}你是「${agent.name}」...
```

- [ ] **Step 10: Read chat.ts lines 120-300** to find where runChatAgent is invoked and where user data is fetched from DB.

- [ ] **Step 11: Fetch custom_instructions and pass to runChatAgent**

Find where nickname is fetched from DB in the chat route handler (search for `SELECT nickname` or `SELECT ... FROM users WHERE id`). Update the SELECT to include `custom_instructions`, then pass it to each `runChatAgent(...)` call.

### diary.ts — passing customInstructions to analyzeDiary

- [ ] **Step 12: Read diary.ts lines 60-200** to find where analyzeDiary is called and where user data is fetched.

- [ ] **Step 13: Fetch custom_instructions and pass to analyzeDiary**

Find where the diary POST route fetches the user record or calls analyzeDiary. Update the user SELECT query to include `custom_instructions`, then pass `user.custom_instructions` to the `analyzeDiary(...)` call.

---

## Task 8: Custom Instructions — AuthContext + SettingsPage UI

**Files:**
- Modify: `packages/web/src/context/AuthContext.tsx`
- Modify: `packages/web/src/pages/SettingsPage.tsx`

### AuthContext.tsx

- [ ] **Step 1: Read full AuthContext.tsx**

- [ ] **Step 2: Add custom_instructions to AuthUser type and updateCustomInstructions method**

Find the `AuthUser` interface and add the field:
```typescript
interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
  nickname: string;
  custom_instructions: string;
}
```

Find the `AuthContextType` interface and add:
```typescript
  updateCustomInstructions: (instructions: string) => Promise<void>;
```

In the provider implementation, add the function (similar to `updateNickname`):
```typescript
  const updateCustomInstructions = async (instructions: string) => {
    const data = await apiClient.patch<AuthUser>('/api/auth/me', { custom_instructions: instructions });
    setUser(data);
  };
```

Include `updateCustomInstructions` in the context value.

### SettingsPage.tsx

- [ ] **Step 3: Read full SettingsPage.tsx**

- [ ] **Step 4: Add custom_instructions textarea to SettingsPage**

Add state variable alongside `nickname` state:
```typescript
  const [customInstructions, setCustomInstructions] = useState('');
  const [instructionsSaved, setInstructionsSaved] = useState(false);
```

In the `useEffect` that loads user data (where `setNickname(user.nickname)` is called), add:
```typescript
    if (user?.custom_instructions !== undefined) setCustomInstructions(user.custom_instructions);
```

Add a save handler:
```typescript
  async function handleInstructionsSave() {
    try {
      await updateCustomInstructions(customInstructions);
      setInstructionsSaved(true);
      setTimeout(() => setInstructionsSaved(false), 2000);
    } catch {
      // handle error
    }
  }
```

Import `useAuth` already exists. Also import `updateCustomInstructions` from it.

Add a new section in the JSX after the nickname section (visible to all logged-in users, `user.role !== 'admin'` check not needed — visible to all):

```tsx
{/* Custom Instructions */}
<div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
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
```

---

## Task 9: Fix Tags User Scoping

**Files:**
- Modify: `packages/server/src/routes/tags.ts`

- [ ] **Step 1: Update tags.ts GET / to require auth and scope to user**

Replace the full `packages/server/src/routes/tags.ts`:
```typescript
import { Router, Request, Response } from "express";
import { sqlite } from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// GET /api/tags — list tags used in the current user's diary entries
router.get("/", requireAuth, (req: Request, res: Response) => {
  try {
    const tags = sqlite
      .prepare(
        `SELECT t.*, COUNT(dt.diary_id) as count
         FROM tags t
         INNER JOIN diary_entry_tags dt ON dt.tag_id = t.id
         INNER JOIN diary_entries d ON dt.diary_id = d.id
         WHERE d.user_id = ?
         GROUP BY t.id
         ORDER BY count DESC`
      )
      .all(req.userId);
    res.json({ tags });
  } catch (err: any) {
    console.error("[tags] List error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});

// DELETE /api/tags/:id — delete tag (cascade removes junction rows)
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    const existing = sqlite
      .prepare("SELECT id FROM tags WHERE id = ?")
      .get(id);

    if (!existing) {
      return res.status(404).json({ error: "標籤不存在" });
    }

    // Remove junction rows first
    sqlite.prepare("DELETE FROM diary_entry_tags WHERE tag_id = ?").run(id);

    // Remove tag
    sqlite.prepare("DELETE FROM tags WHERE id = ?").run(id);

    res.json({ success: true });
  } catch (err: any) {
    console.error("[tags] Delete error:", err);
    res.status(500).json({ error: err.message || "刪除失敗" });
  }
});

export default router;
```

---

## Task 10: Fix Usage Stats for Non-Admin

**Files:**
- Modify: `packages/server/src/routes/settings.ts`

- [ ] **Step 1: Read settings.ts lines 1-20** to confirm imports (need requireAuth import alongside requireAdmin).

- [ ] **Step 2: Update /usage endpoint**

Find the import line for requireAdmin (around line 1-10). Confirm `requireAuth` is also imported. If only `requireAdmin` is imported, add `requireAuth`:
```typescript
import { requireAdmin, requireAuth } from "../middleware/auth.js";
```

Find the `/usage` handler (currently line ~142):
```typescript
// GET /api/settings/usage — aggregated usage stats (admin only)
router.get("/usage", requireAdmin, (_req: Request, res: Response) => {
  try {
    const stats = getUsageStats();
    res.json(stats);
  } catch (err: any) {
    console.error("[settings] Usage stats error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});
```

Replace with:
```typescript
// GET /api/settings/usage — admin: global stats; user: per-user diary AI call counts
router.get("/usage", requireAuth, (req: Request, res: Response) => {
  try {
    if (req.userRole === "admin") {
      const stats = getUsageStats();
      res.json(stats);
      return;
    }

    // Non-admin: count diary entries with AI reflections by date range
    const userId = req.userId;

    const todayCalls = (sqlite
      .prepare(
        `SELECT COUNT(*) as calls FROM diary_entries
         WHERE user_id = ? AND ai_reflection IS NOT NULL
         AND date(created_at) = date('now')`
      )
      .get(userId) as { calls: number }).calls;

    const last7dCalls = (sqlite
      .prepare(
        `SELECT COUNT(*) as calls FROM diary_entries
         WHERE user_id = ? AND ai_reflection IS NOT NULL
         AND created_at >= datetime('now', '-7 days')`
      )
      .get(userId) as { calls: number }).calls;

    const last30dCalls = (sqlite
      .prepare(
        `SELECT COUNT(*) as calls FROM diary_entries
         WHERE user_id = ? AND ai_reflection IS NOT NULL
         AND created_at >= datetime('now', '-30 days')`
      )
      .get(userId) as { calls: number }).calls;

    res.json({
      today: { calls: todayCalls, tokens_in: 0, tokens_out: 0 },
      last7d: { calls: last7dCalls, tokens_in: 0, tokens_out: 0 },
      last30d: { calls: last30dCalls, tokens_in: 0, tokens_out: 0 },
    });
  } catch (err: any) {
    console.error("[settings] Usage stats error:", err);
    res.status(500).json({ error: err.message || "查詢失敗" });
  }
});
```

---

## Task 11: Build Both Packages

- [ ] **Step 1: Build server**

```bash
cd /d/GitClone/_HomeProject/mind-diary/packages/server && npm run build
```

Expected: no TypeScript errors. Fix any type errors before proceeding.

- [ ] **Step 2: Build web**

```bash
cd /d/GitClone/_HomeProject/mind-diary/packages/web && npm run build
```

Expected: no TypeScript/Vite errors. Fix any issues.

---

## Task 12: Version Bump + Commit

- [ ] **Step 1: Bump version**

Read `packages/web/src/version.ts` (or wherever the version is stored) and the `package.json` files, then increment the patch version.

Based on current version (check with `cat packages/web/package.json | grep version`), bump patch:
- `packages/web/package.json`
- `packages/server/package.json`
- `package.json` (root, if it exists)
- `packages/web/src/version.ts` (or similar version file)

- [ ] **Step 2: Commit all changes**

```bash
cd /d/GitClone/_HomeProject/mind-diary
git add -A
git commit -m "feat: dark mode, custom instructions, user-scoped tags, per-user usage stats

- Add full dark mode with class-based Tailwind strategy, localStorage persistence,
  prefers-color-scheme default, and Moon/Sun toggle in sidebar
- Add custom_instructions field to users table; injected into all AI agent system prompts
- Add 自訂指示 textarea in Settings page for all users
- Fix /api/tags to require auth and scope to current user's diary entries
- Fix /api/settings/usage to allow non-admins (returns per-user diary AI call counts)"
```

- [ ] **Step 3: Push**

```bash
git push
```

---

## Self-Review Against Spec

### Spec Coverage Check

| Requirement | Task | Status |
|-------------|------|--------|
| Dark mode toggle in header/settings | Task 2 (sidebar footer) | ✅ |
| Persist in localStorage | Task 1 ThemeContext | ✅ |
| Respect prefers-color-scheme | Task 1 ThemeContext | ✅ |
| Apply to ALL pages | Tasks 2, 3, 4 | ✅ |
| Tailwind class-based on html element | Task 1 ThemeContext (document.documentElement) | ✅ |
| custom_instructions column in users | Task 5 | ✅ |
| PATCH /me accepts custom_instructions (max 500) | Task 6 | ✅ |
| GET /me returns custom_instructions | Task 6 | ✅ |
| buildCustomInstructions in diaryAnalyzer.ts | Task 7 | ✅ |
| buildCustomInstructions in chat.ts | Task 7 | ✅ |
| Prepend to all agent system prompts | Task 7 | ✅ |
| UI textarea in SettingsPage | Task 8 | ✅ |
| Tags: requireAuth | Task 9 | ✅ |
| Tags: filter by user's diary entries | Task 9 | ✅ |
| Usage: change from requireAdmin to requireAuth | Task 10 | ✅ |
| Usage: admin gets global stats | Task 10 | ✅ |
| Usage: non-admin gets diary AI call counts | Task 10 | ✅ |
| Build both packages | Task 11 | ✅ |
| Commit everything | Task 12 | ✅ |

### Notes on Potential Issues
1. **Task 7 Step 11/13**: Chat.ts and diary.ts call sites for custom instructions require reading more of those files. The plan describes the pattern — executor must read those sections first.
2. **Task 4 dark mode Diary/Chat**: These are 1500-1700 line files. Read in chunks, then apply. The class replacement patterns are consistent throughout all pages.
3. **ThemeContext re-render**: The `document.documentElement.classList` manipulation in `useEffect` is side-effect based and won't cause re-renders — this is correct.
4. **userCols re-fetch in Task 5**: We re-fetch `userCols` as `userColsRefreshed` to handle the case where nickname was just added in the same DB connection, ensuring `custom_instructions` migration runs reliably even on first-time DB setup.
