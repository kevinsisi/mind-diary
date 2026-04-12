## MODIFIED Requirements

### Requirement: 日記條目資料隔離

所有日記 API SHALL 根據當前認證使用者的 `user_id` 進行資料過濾，使用者只能存取自己的日記條目。

#### Scenario: 取得日記列表

- **WHEN** 已登入使用者呼叫 GET /api/diary
- **THEN** 只回傳 `user_id` 等於當前使用者 id 的日記條目

#### Scenario: 取得單筆日記

- **WHEN** 已登入使用者呼叫 GET /api/diary/:id
- **THEN** 若該日記的 `user_id` 不符，回傳 404（不揭露他人資料存在）

#### Scenario: 建立日記

- **WHEN** 已登入使用者呼叫 POST /api/diary
- **THEN** 新日記條目的 `user_id` 設為當前使用者 id

#### Scenario: 更新日記

- **WHEN** 已登入使用者呼叫 PUT /api/diary/:id
- **THEN** 只允許更新自己的日記，他人的日記回傳 404

#### Scenario: 刪除日記

- **WHEN** 已登入使用者呼叫 DELETE /api/diary/:id
- **THEN** 只允許刪除自己的日記，他人的日記回傳 404

#### Scenario: 訪客存取公共日記資料

- **WHEN** 未登入使用者呼叫 `/api/diary` 或其附屬子端點
- **THEN** 系統以 `user_id = 0` 作為 diary 的資料隔離範圍，讓訪客只操作公共日記資料與其附屬資源
