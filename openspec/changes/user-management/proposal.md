## Why

Mind Diary 目前是單人無認證服務，Kevin 希望擴展給家人（如 kelly）使用，但每個人的日記、檔案、AI 對話需要完全隔離，同時保留一個訪客共用空間讓家人可以無需登入即可瀏覽公共內容。

## What Changes

- 新增 `users` 資料表，支援帳號密碼認證
- 所有使用者資料表（`files`、`diary_entries`、`chat_sessions`）加入 `user_id` 欄位，實現資料隔離
- 新增 JWT-based 認證（login / logout / me）
- 新增前端登入頁面，路由保護 middleware
- 訪客模式（Guest）：對應特殊 `user_id = 0`，無需登入可瀏覽/操作公共空間
- Admin 角色：可管理其他使用者（新增 / 刪除 / 重設密碼）
- Migration：現有所有資料歸屬到第一個 admin 使用者
- 部署維持輕量，沿用現有 SQLite + Express 架構，不引入 Redis

## Capabilities

### New Capabilities

- `user-auth`: 帳號密碼登入認證，JWT session 管理，前端登入頁面，路由保護 middleware
- `user-management`: Admin 角色管理其他使用者（CRUD），密碼重設，角色設定
- `guest-mode`: 訪客公共空間（`user_id = 0`），無需登入即可瀏覽，內容所有人共用
- `data-migration`: 現有資料遷移到第一個 admin 使用者，DB schema migration 策略

### Modified Capabilities

- `diary`: 日記條目加入 `user_id` — 每位使用者只能看/操作自己的日記
- `file-management`: 檔案加入 `user_id` — 每位使用者只能看/操作自己的檔案
- `ai-chat`: 對話 session 加入 `user_id` — 每位使用者 AI 對話歷史隔離

## Impact

- **DB schema**: 新增 `users` 表；`files`、`diary_entries`、`chat_sessions` 加 `user_id` 欄位
- **後端**: 新增 `auth` 路由，所有資料路由加 `requireAuth` middleware，資料查詢條件加入 `user_id` filter
- **前端**: 新增 `/login` 頁面，`AuthContext` 全域狀態，PrivateRoute wrapper，頂部顯示當前使用者
- **依賴**: 新增 `jsonwebtoken`、`bcryptjs`（輕量，不需 Passport.js）
- **不影響**: Key Pool、Gemini AI 架構、FTS5 搜尋邏輯、Docker 部署設定
- **訪客模式**: `user_id = 0` 為系統保留的 guest user，所有人共用其資料空間
