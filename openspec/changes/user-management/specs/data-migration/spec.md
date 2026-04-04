## ADDED Requirements

### Requirement: 現有資料自動遷移到第一個 Admin
系統 SHALL 在首次啟動新版本時，透過 Drizzle migration 自動將現有資料（files、diary_entries、chat_sessions）的 user_id 設為 1（第一個 admin）。

#### Scenario: Migration 自動執行
- **WHEN** 新版 Docker image 首次啟動
- **THEN** Drizzle migration 自動執行，現有資料的 user_id 全部設為 1，不需手動介入

#### Scenario: 重複執行 migration 冪等
- **WHEN** Migration 被執行多次（如容器重啟）
- **THEN** Drizzle migration 系統追蹤已執行的 migration，不重複執行

### Requirement: Admin 使用者必須在 migration 前建立
系統 SHALL 確保 `users` 表中 id=1 的 admin 使用者在 user_id 欄位 migration 執行前就存在。

#### Scenario: 首次部署 migration 順序
- **WHEN** 全新部署執行 migration
- **THEN** 依序：1) 建立 users 表並插入 admin（id=1），2) 為現有表加 user_id DEFAULT 1

### Requirement: 部署前 DB 備份
運維文件 SHALL 記錄在執行 migration 前需備份現有 SQLite DB。

#### Scenario: 備份指令
- **WHEN** 執行 migration 前
- **THEN** 執行 `cp /data/mind-diary.db /data/mind-diary.db.backup`

### Requirement: Rollback 策略
系統 SHALL 支援回滾到舊版本，方法為還原備份 DB 並啟動舊版 Docker image。

#### Scenario: Rollback 執行
- **WHEN** 新版本有問題需要回滾
- **THEN** `docker compose down`、還原備份 DB、啟動舊版 image，資料完整保留

### Requirement: 初始 Admin 帳號設定
系統 SHALL 支援透過環境變數（`ADMIN_USERNAME`、`ADMIN_PASSWORD`）設定初始 admin 帳號，若 users 表為空時自動建立。

#### Scenario: 首次啟動建立 Admin
- **WHEN** users 表為空且環境變數有設定
- **THEN** 系統自動建立 id=1 的 admin 帳號

#### Scenario: 未設定環境變數的預設值
- **WHEN** 未設定 `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- **THEN** 系統使用預設值 `admin` / `admin123`，並在 log 警告「請儘速修改預設密碼」
