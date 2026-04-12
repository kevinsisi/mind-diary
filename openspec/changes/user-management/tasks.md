## 1. 基礎建設（Dependencies & DB Schema）

- [x] 1.1 安裝後端依賴：`jsonwebtoken`、`@types/jsonwebtoken`、`bcryptjs`、`@types/bcryptjs`、`cookie-parser`、`@types/cookie-parser`
- [x] 1.2 新增 `users` 表到 `packages/server/src/db/schema.ts`（id, username, password_hash, role, created_at）
- [x] 1.3 修改 `files` schema，加入 `user_id INTEGER NOT NULL DEFAULT 1`
- [x] 1.4 修改 `diary_entries` schema，加入 `user_id INTEGER NOT NULL DEFAULT 1`
- [x] 1.5 修改 `chat_sessions` schema，加入 `user_id INTEGER NOT NULL DEFAULT 1`
- [x] 1.6 建立 Drizzle migration：`0001_add_users_table.sql`（建立 users 表 + 插入預設 admin）
- [x] 1.7 建立 Drizzle migration：`0002_add_user_id_columns.sql`（ALTER TABLE 加 user_id DEFAULT 1）
- [x] 1.8 確認 `packages/server/src/db/index.ts` 在啟動時自動執行 migrations

## 2. 後端認證層（Auth Middleware & Routes）

- [x] 2.1 建立 `packages/server/src/middleware/auth.ts`：`requireAuth` middleware（驗證 JWT cookie，查 DB 確認使用者存在）
- [x] 2.2 在 `auth.ts` middleware 新增 `optionalAuth`（無 token 時 `req.userId = 0, req.userRole = 'guest'`）
- [x] 2.3 建立 `packages/server/src/middleware/requireAdmin.ts`：admin-only middleware
- [x] 2.4 建立 `packages/server/src/routes/auth.ts`：`POST /api/auth/login`（bcryptjs 驗證，設 httpOnly cookie）
- [x] 2.5 新增 `POST /api/auth/logout`（清除 cookie）
- [x] 2.6 新增 `GET /api/auth/me`（回傳當前使用者資訊）
- [x] 2.7 新增 `PATCH /api/auth/me`（使用者修改自己的暱稱與自訂指令）
- [x] 2.8 在 `packages/server/src/routes/auth.ts` 提供 Admin CRUD（GET/POST/PATCH/DELETE `/api/auth/users`）
- [x] 2.9 在 `packages/server/src/index.ts` 掛載 `cookie-parser`，註冊 auth 路由

## 3. 後端資料隔離（現有路由加 user_id filter）

- [x] 3.1 修改 `packages/server/src/routes/diary.ts`：所有查詢加 `user_id = req.userId` filter，並讓 guest 走 `user_id = 0` 公共空間
- [x] 3.2 修改 `packages/server/src/routes/files.ts`：所有查詢加 `user_id = req.userId` filter，改用 `optionalAuth`（訪客可用）
- [x] 3.3 修改 `packages/server/src/routes/chat.ts`：sessions 查詢加 `user_id = req.userId` filter，改用 `optionalAuth`
- [x] 3.4 修改 `packages/server/src/routes/search.ts`：FTS5 結果 JOIN 主表後加 `user_id = req.userId` filter
- [x] 3.5 修改 `packages/server/src/routes/folders.ts` 和 `tags.ts`：確認 user_id 隔離（若相關表有 user_id）
- [x] 3.6 確認 RAG chat（`packages/server/src/ai/`）的 context stuffing 只撈當前 user_id 的資料

## 4. 初始化：自動建立 Admin 帳號

- [x] 4.1 在 `packages/server/src/index.ts` 啟動時檢查 users 表是否為空，若空則讀取 `ADMIN_USERNAME`/`ADMIN_PASSWORD` env 建立 admin（id=1），並 log 警告若使用預設密碼
- [x] 4.2 在 `packages/server/src/index.ts` 啟動時補齊 legacy `users` 表的 profile 欄位（`nickname`、`custom_instructions`），避免 request path 才做 schema backfill

## 5. 前端：AuthContext 與路由保護

- [x] 5.1 安裝前端依賴（若需要）：確認 `axios`/`fetch` 帶 `withCredentials: true`
- [x] 5.2 建立 `packages/web/src/context/AuthContext.tsx`：`{ user, login, logout, isLoading }` 狀態，啟動時呼叫 `/api/auth/me` 初始化
- [x] 5.3 在 `packages/web/src/main.tsx` 或 `App.tsx` 用 `AuthProvider` 包裹整個 app
- [x] 5.4 建立 `packages/web/src/components/PrivateRoute.tsx`：未登入則重導向 `/login`
- [x] 5.5 修改 `packages/web/src/App.tsx` 路由：`/diary`、`/settings` 改用 `<PrivateRoute>`；`/admin/users` 加 admin 判斷

## 6. 前端：登入頁面

- [x] 6.1 建立 `packages/web/src/pages/LoginPage.tsx`：繁體中文登入表單（username/password），呼叫 `POST /api/auth/login`
- [x] 6.2 登入成功後重導向到目標頁（`location.state.from`）或 `/`
- [x] 6.3 修改導覽列元件（Navbar/Sidebar）：已登入顯示使用者名稱和登出按鈕；未登入顯示「訪客模式」標籤和「登入」按鈕

## 7. 前端：Admin 使用者管理頁面

- [x] 7.1 建立 `packages/web/src/pages/AdminUsersPage.tsx`：顯示使用者列表（username, role, created_at）
- [x] 7.2 新增「新增使用者」表單（username, password, role）
- [x] 7.3 新增「刪除使用者」按鈕（非最後一個 admin 才可刪）
- [x] 7.4 新增「重設密碼」對話框
- [x] 7.5 在 `App.tsx` 新增 `/admin/users` 路由（admin-only PrivateRoute）

## 8. 前端：訪客模式 UI

- [x] 8.1 在 Dashboard、Files、Chat 頁面顯示訪客模式提示橫幅（「您目前以訪客身份瀏覽，資料為公共空間」）
- [x] 8.2 確認前端 API client（`packages/web/src/api/client.ts`）所有請求帶 `credentials: 'include'`

## 9. 環境變數與 Docker 設定

- [x] 9.1 新增 `JWT_SECRET` 環境變數到 `docker-compose.yml`（`packages/server/src/` 中讀取）
- [x] 9.2 新增 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 環境變數到 `docker-compose.yml`（有預設值）
- [x] 9.3 更新 `packages/server/src/index.ts` 讀取 `JWT_SECRET`（確保 production 安全）

## 10. 測試與部署驗收

- [ ] 10.1 本機測試：登入/登出流程、JWT cookie 驗證、admin 管理功能
- [ ] 10.2 本機測試：訪客模式資料隔離（guest vs 登入使用者）
- [ ] 10.3 本機測試：日記 API 在訪客模式下只操作 `user_id = 0` 的公共資料
- [ ] 10.4 RPi 部署前備份 DB：`cp /data/mind-diary.db /data/mind-diary.db.backup`
- [ ] 10.5 部署新版 Docker image 到 RPi，確認 migration 自動執行
- [ ] 10.6 驗收：使用 admin 帳號登入，確認現有資料可正常存取
- [ ] 10.7 驗收：新增第二個使用者帳號，確認資料完全隔離
- [ ] 10.8 bump version：`version.ts` + 3 個 `package.json`（root, server, web）→ commit → push
- [x] 10.9 補上 backend 的最後一個 admin 不可刪保護，避免只靠前端預期訊息
- [x] 10.10 明確記錄 guest diary API 使用公共空間（user_id=0），避免與登入後的日記頁面限制混淆
