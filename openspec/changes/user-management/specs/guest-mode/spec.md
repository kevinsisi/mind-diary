## ADDED Requirements

### Requirement: 訪客可無需登入瀏覽公共空間

系統 SHALL 允許未登入訪客存取特定頁面，訪客操作的資料以 `user_id = 0` 儲存，為所有訪客共用的公共空間。

#### Scenario: 訪客存取 Dashboard

- **WHEN** 未登入使用者存取 `/`
- **THEN** 顯示 Dashboard，顯示 guest 的公共資料（user_id=0 的檔案、chat 記錄），並顯示「訪客模式」提示

#### Scenario: 訪客存取檔案頁面

- **WHEN** 未登入使用者存取 `/files`
- **THEN** 顯示 user_id=0 的公共檔案列表，可上傳新檔案（歸屬 user_id=0）

#### Scenario: 訪客存取 AI 對話

- **WHEN** 未登入使用者存取 `/chat`
- **THEN** 顯示 user_id=0 的公共 chat sessions，可建立新對話（歸屬 user_id=0）

### Requirement: 訪客無法存取日記頁面，但可使用公共 diary API

前端日記頁面（`/diary`）為登入後功能；但 diary API 與其附屬子端點對訪客 SHALL 指向 `user_id = 0` 的公共空間，供匿名模式與公共搜尋使用。

#### Scenario: 訪客嘗試存取日記

- **WHEN** 未登入使用者存取 `/diary`
- **THEN** 前端重導向到 `/login`，顯示「日記功能需要登入」

#### Scenario: 訪客取得公共日記列表

- **WHEN** 未登入使用者呼叫 `GET /api/diary`
- **THEN** 系統回傳 `user_id = 0` 的公共日記資料

#### Scenario: 訪客取得公共單筆日記

- **WHEN** 未登入使用者呼叫 `GET /api/diary/:id`
- **THEN** 若該日記屬於 `user_id = 0`，系統回傳該公共日記資料

#### Scenario: 訪客操作公共 diary API

- **WHEN** 未登入使用者呼叫 `/api/diary` 及其附屬子端點
- **THEN** 系統只允許讀寫 `user_id = 0` 的公共日記資料與其附屬資源

### Requirement: 訪客公共資料與登入使用者資料隔離

系統 SHALL 確保 guest（user_id=0）的資料與登入使用者的資料完全隔離。

#### Scenario: 登入使用者不看到 guest 資料

- **WHEN** 登入使用者（user_id=1）存取 /api/files
- **THEN** 只回傳 user_id=1 的檔案，不包含 user_id=0 的公共檔案

#### Scenario: 訪客不看到登入使用者資料

- **WHEN** 訪客（user_id=0）存取 /api/files
- **THEN** 只回傳 user_id=0 的公共檔案

### Requirement: 導覽列顯示訪客模式狀態

系統 SHALL 在未登入時於導覽列顯示「訪客模式」標示和登入按鈕。

#### Scenario: 訪客瀏覽頁面

- **WHEN** 未登入使用者瀏覽任何頁面
- **THEN** 導覽列顯示「訪客模式」標籤和「登入」按鈕，不顯示使用者名稱
