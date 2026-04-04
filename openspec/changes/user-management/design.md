## Context

Mind Diary 目前是單人無認證服務，所有資料共用同一個 SQLite 資料庫，沒有 `user_id` 隔離。現在要支援 2 個具名使用者 + 訪客模式（guest），每個使用者的資料必須完全隔離。

現有 schema（`files`、`diary_entries`、`chat_sessions`）皆無 `user_id`，需要 migration。部署在 RPi Manjaro ARM，資源有限，方案必須輕量。

## Goals / Non-Goals

**Goals:**
- 帳號密碼認證，JWT cookie-based session（httpOnly）
- 2 個具名使用者帳號 + admin 角色
- 訪客模式：`user_id = 0`，公共空間，無需登入
- 所有現有資料遷移至第一個 admin 使用者
- Admin 可新增/刪除使用者、重設密碼
- 前端登入頁面 + 路由保護
- 沿用 SQLite + Express，不引入 Redis 或外部 session store

**Non-Goals:**
- OAuth / SSO / 第三方登入
- Email 驗證 / 密碼找回
- 細粒度 RBAC（只需 admin / user / guest 三層）
- 多裝置並發 session 管理（家用場景不需要）
- IPv6 支援

## Decisions

### 1. JWT 存放方式：httpOnly Cookie（非 Authorization header）

**選擇**：JWT 存在 httpOnly cookie（`access_token`），而非 `Authorization: Bearer` header。

**原因**：
- 前端不需要手動管理 token，每個 request 自動帶上
- httpOnly 防止 XSS 竊取 token
- 在 Tailscale 私有網路內，CSRF 風險極低，不需要額外的 CSRF token

**放棄方案**：`Authorization` header 需要前端在所有 API call 手動附加，且 localStorage 儲存有 XSS 風險。

### 2. 密碼雜湊：bcryptjs（非 argon2）

**選擇**：`bcryptjs`（純 JS 實現）而非 `argon2` 或 `bcrypt`（native binding）。

**原因**：
- RPi aarch64 環境下 native binding 編譯複雜
- bcryptjs 純 JS，跨平台無痛，cost factor 12 對家用場景足夠
- 無需 node-gyp

### 3. Guest User：`user_id = 0` 系統保留

**選擇**：guest 不是資料庫中的真實使用者，而是 `user_id = 0` 作為系統常數。所有「未登入」的請求自動使用 `user_id = 0`。

**原因**：
- 不需要在 `users` 表維護 guest 記錄
- 程式碼中 `const GUEST_USER_ID = 0` 語義清晰
- Guest 資料和登入使用者資料完全隔離

**放棄方案**：把 guest 當作一般使用者但 `is_guest = true`，增加複雜度。

### 4. Migration 策略：帶 default 值的 ALTER TABLE

**選擇**：用 Drizzle migration 在現有表加 `user_id INTEGER NOT NULL DEFAULT 1`，現有資料自動歸屬到 `user_id = 1`（第一個 admin）。

**原因**：
- SQLite 的 `ALTER TABLE ADD COLUMN` 支援 `DEFAULT`，不需要重建表
- 第一次部署時確保 admin 使用者（`id = 1`）先建立
- Migration 一次性，不需要複雜的資料轉移腳本

### 5. 前端路由保護：AuthContext + PrivateRoute

**選擇**：全域 `AuthContext`（`useAuth()` hook）+ `<PrivateRoute>` wrapper 組件。

**DB Schema 變更：**

```
新增 users 表：
- id: INTEGER PRIMARY KEY AUTOINCREMENT
- username: TEXT NOT NULL UNIQUE
- password_hash: TEXT NOT NULL
- role: TEXT NOT NULL DEFAULT 'user'  -- 'admin' | 'user'
- created_at: TEXT

修改現有表（加 user_id）：
- files.user_id: INTEGER NOT NULL DEFAULT 1
- diary_entries.user_id: INTEGER NOT NULL DEFAULT 1
- chat_sessions.user_id: INTEGER NOT NULL DEFAULT 1
```

**後端新增檔案：**
```
packages/server/src/
├── middleware/
│   ├── auth.ts          # requireAuth, optionalAuth (guest fallback)
│   └── requireAdmin.ts  # admin-only routes
├── routes/
│   └── auth.ts          # POST /login, POST /logout, GET /me
│   └── users.ts         # Admin: CRUD users (GET/POST/DELETE/PATCH)
└── db/
    └── migrations/      # 0001_add_users.sql, 0002_add_user_id.sql
```

**前端新增檔案：**
```
packages/web/src/
├── context/
│   └── AuthContext.tsx  # 全域認證狀態
├── components/
│   └── PrivateRoute.tsx # 路由保護
└── pages/
    └── LoginPage.tsx    # 登入頁面
```

**路由表更新：**
| 路由 | 保護等級 | 說明 |
|------|---------|------|
| `/login` | 公開 | 登入頁 |
| `/` | Guest+ | Dashboard（guest 看公共資料）|
| `/files` | Guest+ | 檔案（guest 看 user_id=0 檔案）|
| `/diary` | 登入 | 日記（guest 無法存取）|
| `/chat` | Guest+ | AI 對話（guest 用公共 session）|
| `/settings` | 登入 | 設定 |
| `/admin/users` | Admin | 使用者管理 |

## Risks / Trade-offs

- **[JWT 無法強制失效]** → Mitigation: 短 TTL（7 天），admin 可刪使用者讓其 token 在驗證時失效（查 DB 確認使用者存在）
- **[bcryptjs 效能]** RPi 上 bcryptjs cost 12 約 300ms/hash → Mitigation: 登入操作不頻繁，可接受；cost factor 可降至 10
- **[FTS5 虛擬表無 user_id]** FTS5 虛擬表（`files_fts`、`diary_fts`）不能直接加 user_id filter → Mitigation: FTS5 搜尋後 JOIN 主表再加 user_id filter
- **[現有資料歸屬]** Migration 後所有資料屬於 admin（user_id=1），其他使用者從空白開始 → 可接受，Kevin 是唯一現有使用者

## Migration Plan

1. 部署前：在 RPi 備份現有 SQLite DB（`cp mind-diary.db mind-diary.db.backup`）
2. 新版 Docker image 啟動時自動執行 Drizzle migration：
   a. 建立 `users` 表，插入第一個 admin（`id = 1`）
   b. `ALTER TABLE files ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`
   c. `ALTER TABLE diary_entries ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`
   d. `ALTER TABLE chat_sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`
3. 第一次登入後可從 Admin 頁面新增其他使用者
4. Rollback：`docker compose down && cp mind-diary.db.backup mind-diary.db && docker compose up -d`（回到舊 image）
