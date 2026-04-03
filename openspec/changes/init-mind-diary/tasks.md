## 1. Infrastructure / 專案初始化

- [x] 1.1 初始化 monorepo：root package.json (workspaces)、tsconfig.json、.gitignore
- [x] 1.2 初始化 packages/server：package.json、tsconfig.json、Express entry point
- [x] 1.3 初始化 packages/web：Vite + React + TypeScript scaffold
- [x] 1.4 建立 Dockerfile（multi-stage: build TS + bundle frontend → runtime）
- [x] 1.5 建立 docker-compose.yml（port 8823、volume mounts for data/）
- [x] 1.6 建立 .env.example（GEMINI_API_KEYS, PORT, DATABASE_PATH）

## 2. Database / 資料庫

- [x] 2.1 安裝 better-sqlite3 + drizzle-orm + drizzle-kit
- [x] 2.2 定義 Drizzle schema：files, diary_entries, chat_sessions, chat_messages
- [x] 2.3 定義 Drizzle schema：api_keys, api_key_cooldowns, api_key_usage
- [x] 2.4 建立 FTS5 虛擬表：files_fts, diary_fts（中文 tokenizer 配置）
- [x] 2.5 建立 migration 腳本 + 自動 migrate on startup
- [x] 2.6 新增 tags, diary_entry_tags, folders, chat_folders 表
- [x] 2.7 新增 ai_agents, folder_id 欄位到 diary_entries 和 chat_sessions

## 3. Key Pool / AI 金鑰池

- [x] 3.1 從 project-bridge 複製 keyPool.ts 並適配（key CRUD、Fisher-Yates、cooldown 查詢）
- [x] 3.2 從 project-bridge 複製 geminiRetry.ts 並適配（withGeminiRetry、withStreamRetry、錯誤分級 cooldown）
- [x] 3.3 從 project-bridge 複製 batchCaller.ts 並適配（createBatchCaller）
- [x] 3.4 實作 key management REST API：GET/POST/DELETE /api/settings/keys
- [x] 3.5 實作 batch import + batch validate endpoints
- [x] 3.6 實作 usage tracking（api_key_usage 記錄 + 統計 API）
- [x] 3.7 實作 ENV key 載入（GEMINI_API_KEYS 解析 + startup load）

## 4. Backend API / 後端核心

- [x] 4.1 實作檔案上傳 API：POST /api/files（multer + 格式驗證 + 大小限制）
- [x] 4.2 實作檔案文字抽取 service（pdf-parse + 純文字讀取）
- [x] 4.3 實作圖片 OCR service（Gemini vision API）
- [x] 4.4 實作 AI 檔案摘要 service（上傳後自動觸發）
- [x] 4.5 實作檔案 CRUD API：GET /api/files、DELETE /api/files/:id
- [x] 4.6 實作檔案 FTS5 索引（上傳時 insert、刪除時 remove）
- [x] 4.7 實作日記 CRUD API：GET/POST/PUT/DELETE /api/diary
- [x] 4.8 實作多 Agent AI 日記分析（5 位好友 + 整合者，SSE streaming）
- [x] 4.9 實作日記 FTS5 索引（CRUD 同步更新）
- [x] 4.10 實作統一搜尋 API：GET /api/search（FTS5 query + highlight + 分頁）
- [x] 4.11 實作日記資料夾 CRUD + 標籤 CRUD API
- [x] 4.12 實作 AI 自動標籤（日記建立後自動生成）

## 5. AI Agent / 對話系統

- [x] 5.1 實作 chat session CRUD API（含資料夾支援）
- [x] 5.2 實作多 Agent chat SSE：選人 → 平行討論 → 整合回覆
- [x] 5.3 實作 Context Stuffing 引擎：FTS5 搜尋 → top-K 選取
- [x] 5.4 實作 RAG prompt 組裝（system prompt + file context + session history + user query）
- [x] 5.5 整合 withStreamRetry() 到所有 AI streaming 呼叫（自動換 key）
- [x] 5.6 實作 AI 好友系統：agents.ts（5 personas + master prompt）
- [x] 5.7 實作 diaryAnalyzer.ts（多 Agent 平行分析 + SSE orchestration）
- [x] 5.8 實作對話資料夾 CRUD

## 6. Frontend / 前端 UI

- [x] 6.1 建立共用 layout：sidebar 導覽、header、繁體中文 UI
- [x] 6.2 建立 API client 層（fetch wrapper + error handling）
- [x] 6.3 實作 Dashboard 頁面（統計、最近日記、標籤雲、AI 好友團隊、快速操作）
- [x] 6.4 實作檔案管理頁面（拖拽上傳、AI 摘要、重新分析）
- [x] 6.5 實作日記頁面（三欄 ChatGPT 佈局、資料夾、標籤、mood、多 Agent thinking UI）
- [x] 6.6 實作 AI 對話頁面（session 列表、資料夾、多 Agent thinking、SSE streaming）
- [x] 6.7 實作搜尋頁面（統一搜尋、來源篩選、highlight、標籤顯示）
- [x] 6.8 實作設定頁面（API key 管理、新增/刪除/批次匯入、usage 圖表）

## 7. Integration / 整合部署

- [x] 7.1 Docker build 成功（arm64 Alpine）
- [x] 7.2 部署到 RPi：docker compose up
- [x] 7.3 更新 Caddy config：diary.sisihome.org + diary.sisihome（含 flush_interval -1 for SSE）
- [x] 7.4 更新 CLAUDE.md URL routing table
- [ ] 7.5 端到端驗證：API key 配額恢復後全功能測試
- [ ] 7.6 圖片/附件上傳整合到日記（日記內嵌圖片 + AI 分析）
