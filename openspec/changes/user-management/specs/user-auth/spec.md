## ADDED Requirements

### Requirement: 使用者帳號密碼登入
系統 SHALL 支援帳號密碼登入，驗證成功後發放 JWT 存在 httpOnly cookie（`access_token`），TTL 為 7 天。

#### Scenario: 登入成功
- **WHEN** 使用者提交正確的 username 和 password
- **THEN** 系統回傳 200，設定 `access_token` httpOnly cookie，回傳使用者資訊（id, username, role）

#### Scenario: 帳號不存在
- **WHEN** 使用者提交不存在的 username
- **THEN** 系統回傳 401，不揭露帳號是否存在

#### Scenario: 密碼錯誤
- **WHEN** 使用者提交錯誤的 password
- **THEN** 系統回傳 401，錯誤訊息一律為「帳號或密碼錯誤」

### Requirement: 登出
系統 SHALL 提供登出端點，清除 cookie。

#### Scenario: 登出成功
- **WHEN** 已登入使用者呼叫 POST /api/auth/logout
- **THEN** 系統清除 `access_token` cookie，回傳 200

### Requirement: 取得當前使用者資訊
系統 SHALL 提供 GET /api/auth/me 端點，回傳當前認證使用者資訊。

#### Scenario: 已登入使用者
- **WHEN** 攜帶有效 JWT cookie 呼叫 GET /api/auth/me
- **THEN** 回傳 { id, username, role }

#### Scenario: 未登入
- **WHEN** 無 JWT cookie 呼叫 GET /api/auth/me
- **THEN** 回傳 401

### Requirement: 路由保護 middleware
系統 SHALL 在所有需要認證的 API 路由加上 `requireAuth` middleware；訪客可存取的路由使用 `optionalAuth` middleware（無 token 時 `req.userId = 0`）。

#### Scenario: 有效 token 通過驗證
- **WHEN** request 攜帶有效 JWT cookie
- **THEN** middleware 解析 token，設定 `req.userId` 和 `req.userRole`，放行請求

#### Scenario: 無效或過期 token
- **WHEN** request 攜帶過期或偽造的 JWT
- **THEN** `requireAuth` middleware 回傳 401；`optionalAuth` middleware 設定 `req.userId = 0` 並放行

#### Scenario: 已刪除使用者的 token
- **WHEN** JWT 有效但對應 user_id 在 DB 中不存在
- **THEN** middleware 回傳 401（token revocation via DB check）

### Requirement: 前端登入頁面
系統 SHALL 提供 `/login` 路由，顯示繁體中文登入表單。

#### Scenario: 未登入訪問受保護頁面
- **WHEN** 未登入使用者存取需要登入的頁面（如 `/diary`）
- **THEN** 前端重導向到 `/login`

#### Scenario: 登入後重導向
- **WHEN** 登入成功
- **THEN** 前端重導向到原本要存取的頁面，或預設到 `/`

#### Scenario: 顯示當前使用者
- **WHEN** 使用者已登入
- **THEN** 導覽列顯示使用者名稱和登出按鈕
