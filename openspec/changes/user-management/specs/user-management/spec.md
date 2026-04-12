## ADDED Requirements

### Requirement: Admin 可建立使用者帳號

Admin 角色 SHALL 能透過 `POST /api/auth/users` 建立新使用者，指定 username、password、role。

#### Scenario: 建立使用者成功

- **WHEN** Admin 提交有效的 username、password、role
- **THEN** 系統建立使用者，密碼以 bcryptjs cost 10 雜湊儲存，回傳 201 和新使用者資訊（不含 password_hash）

#### Scenario: 使用者名稱重複

- **WHEN** Admin 提交已存在的 username
- **THEN** 系統回傳 409，錯誤訊息「帳號已存在」

#### Scenario: 非 Admin 嘗試建立使用者

- **WHEN** 一般使用者（role=user）呼叫 `POST /api/auth/users`
- **THEN** 系統回傳 403

### Requirement: Admin 可列出所有使用者

Admin 角色 SHALL 能透過 `GET /api/auth/users` 取得所有使用者清單（不含 password_hash）。

#### Scenario: 取得使用者清單

- **WHEN** Admin 呼叫 `GET /api/auth/users`
- **THEN** 系統回傳使用者陣列，每筆包含 { id, username, role, created_at }

### Requirement: Admin 可刪除使用者

Admin 角色 SHALL 能透過 `DELETE /api/auth/users/:id` 刪除使用者。

#### Scenario: 刪除使用者成功

- **WHEN** Admin 刪除存在的非 admin 使用者
- **THEN** 系統回傳 200，該使用者帳號被刪除

#### Scenario: 不能刪除最後一個 Admin

- **WHEN** 系統中只剩一個 admin 帳號，且收到刪除該帳號的請求
- **THEN** 系統必須拒絕刪除，避免管理員帳號歸零

#### Scenario: 不能將最後一個 Admin 降權

- **WHEN** 系統中只剩一個 admin 帳號，且收到將該帳號角色改為 `user` 的請求
- **THEN** 系統必須拒絕降權，避免管理員帳號歸零

#### Scenario: Admin 嘗試刪除自己

- **WHEN** Admin 對自己的帳號送出刪除請求
- **THEN** 系統回傳 400，錯誤訊息「不能刪除自己」

#### Scenario: Admin 刪除多管理員中的其中一位

- **WHEN** Admin 刪除存在的 admin 使用者，且系統中仍有其他 admin
- **THEN** 系統回傳 200，刪除目標帳號

### Requirement: Admin 可重設使用者密碼

Admin 角色 SHALL 能透過 `PATCH /api/auth/users/:id` 提交 `password` 來重設任何使用者的密碼。

#### Scenario: 重設密碼成功

- **WHEN** Admin 提交新密碼
- **THEN** 系統更新密碼雜湊，回傳 200

### Requirement: 使用者可修改自己的個人設定

已登入使用者 SHALL 能透過 `PATCH /api/auth/me` 修改自己的暱稱與自訂指令。

#### Scenario: 修改個人設定成功

- **WHEN** 使用者提交合法的 `nickname` 或 `custom_instructions`
- **THEN** 系統更新自己的個人設定並回傳更新後資料

#### Scenario: 未登入時修改個人設定

- **WHEN** 未登入使用者呼叫 `PATCH /api/auth/me`
- **THEN** 系統回傳 401

### Requirement: Admin 使用者管理頁面

系統 SHALL 提供 `/admin/users` 前端頁面，僅 admin 可存取，顯示使用者列表並支援新增/刪除/重設密碼操作。

#### Scenario: 非 Admin 訪問管理頁面

- **WHEN** 一般使用者存取 `/admin/users`
- **THEN** 前端重導向到 `/`，顯示無權限提示
