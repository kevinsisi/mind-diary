## ADDED Requirements

### Requirement: Admin 可建立使用者帳號
Admin 角色 SHALL 能透過 POST /api/users 建立新使用者，指定 username、password、role。

#### Scenario: 建立使用者成功
- **WHEN** Admin 提交有效的 username、password、role
- **THEN** 系統建立使用者，密碼以 bcryptjs cost 12 雜湊儲存，回傳 201 和新使用者資訊（不含 password_hash）

#### Scenario: 使用者名稱重複
- **WHEN** Admin 提交已存在的 username
- **THEN** 系統回傳 409，錯誤訊息「使用者名稱已存在」

#### Scenario: 非 Admin 嘗試建立使用者
- **WHEN** 一般使用者（role=user）呼叫 POST /api/users
- **THEN** 系統回傳 403

### Requirement: Admin 可列出所有使用者
Admin 角色 SHALL 能透過 GET /api/users 取得所有使用者清單（不含 password_hash）。

#### Scenario: 取得使用者清單
- **WHEN** Admin 呼叫 GET /api/users
- **THEN** 系統回傳使用者陣列，每筆包含 { id, username, role, created_at }

### Requirement: Admin 可刪除使用者
Admin 角色 SHALL 能透過 DELETE /api/users/:id 刪除使用者。

#### Scenario: 刪除使用者成功
- **WHEN** Admin 刪除存在的非 admin 使用者
- **THEN** 系統回傳 200，該使用者的 JWT 在下次驗證時因 DB check 失效

#### Scenario: 不能刪除最後一個 Admin
- **WHEN** Admin 嘗試刪除唯一的 admin 帳號
- **THEN** 系統回傳 400，錯誤訊息「無法刪除最後一個管理員帳號」

### Requirement: Admin 可重設使用者密碼
Admin 角色 SHALL 能透過 PATCH /api/users/:id/password 重設任何使用者的密碼。

#### Scenario: 重設密碼成功
- **WHEN** Admin 提交新密碼
- **THEN** 系統更新密碼雜湊，回傳 200

### Requirement: 使用者可修改自己的密碼
已登入使用者 SHALL 能透過 PATCH /api/auth/password 修改自己的密碼，需提供舊密碼驗證。

#### Scenario: 修改密碼成功
- **WHEN** 使用者提交正確的舊密碼和新密碼
- **THEN** 系統更新密碼雜湊，回傳 200

#### Scenario: 舊密碼錯誤
- **WHEN** 使用者提交錯誤的舊密碼
- **THEN** 系統回傳 401

### Requirement: Admin 使用者管理頁面
系統 SHALL 提供 `/admin/users` 前端頁面，僅 admin 可存取，顯示使用者列表並支援新增/刪除/重設密碼操作。

#### Scenario: 非 Admin 訪問管理頁面
- **WHEN** 一般使用者存取 `/admin/users`
- **THEN** 前端重導向到 `/`，顯示無權限提示
