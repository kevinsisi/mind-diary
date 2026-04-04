## MODIFIED Requirements

### Requirement: Chat session 資料隔離
所有 chat API SHALL 根據當前使用者的 `user_id` 過濾 session，使用者只能存取自己的對話記錄；訪客（user_id=0）共用公共 chat 空間。

#### Scenario: 取得 chat sessions（登入使用者）
- **WHEN** 已登入使用者呼叫 GET /api/chat/sessions
- **THEN** 只回傳 `user_id` 等於當前使用者 id 的 sessions

#### Scenario: 取得 chat sessions（訪客）
- **WHEN** 未登入訪客呼叫 GET /api/chat/sessions
- **THEN** 只回傳 `user_id = 0` 的公共 sessions

#### Scenario: 建立新 chat session（登入使用者）
- **WHEN** 已登入使用者建立新 session
- **THEN** 新 session 的 `user_id` 設為當前使用者 id

#### Scenario: 建立新 chat session（訪客）
- **WHEN** 訪客建立新 session
- **THEN** 新 session 的 `user_id` 設為 0

#### Scenario: 存取他人 session
- **WHEN** 使用者嘗試存取 `user_id` 不符的 session
- **THEN** 系統回傳 404

#### Scenario: RAG 搜尋隔離
- **WHEN** 使用者進行 RAG 對話
- **THEN** Context Stuffing 只包含當前使用者（含 guest=0）的檔案和日記，不跨使用者資料
