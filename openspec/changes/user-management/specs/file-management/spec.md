## MODIFIED Requirements

### Requirement: 檔案資料隔離
所有檔案 API SHALL 根據當前使用者的 `user_id` 過濾資料，使用者只能存取自己的檔案；訪客（user_id=0）存取公共空間的檔案。

#### Scenario: 取得檔案列表（登入使用者）
- **WHEN** 已登入使用者呼叫 GET /api/files
- **THEN** 只回傳 `user_id` 等於當前使用者 id 的檔案

#### Scenario: 取得檔案列表（訪客）
- **WHEN** 未登入訪客呼叫 GET /api/files
- **THEN** 只回傳 `user_id = 0` 的公共檔案

#### Scenario: 上傳檔案（登入使用者）
- **WHEN** 已登入使用者上傳檔案
- **THEN** 新檔案的 `user_id` 設為當前使用者 id

#### Scenario: 上傳檔案（訪客）
- **WHEN** 訪客上傳檔案
- **THEN** 新檔案的 `user_id` 設為 0（公共空間）

#### Scenario: 刪除他人檔案
- **WHEN** 使用者嘗試刪除 `user_id` 不符的檔案
- **THEN** 系統回傳 404

#### Scenario: FTS5 搜尋結果隔離
- **WHEN** 使用者執行全文搜尋
- **THEN** 搜尋結果只包含當前使用者（含 guest=0）的檔案，FTS5 結果 JOIN 主表後加 user_id filter
