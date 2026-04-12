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
- [x] 4.13 補強 diary 背景標題清洗與有效性檢查，避免壞 AI 標題覆蓋 fallback title
- [x] 4.14 補強 diary 背景標題的重試與 heuristic fallback，避免第一輪 AI 失敗就停在粗略前綴標題

## 5. AI Agent / 對話系統

- [x] 5.1 實作 chat session CRUD API（含資料夾支援）
- [x] 5.2 實作多 Agent chat SSE：選人 → 平行討論 → 整合回覆
- [x] 5.3 實作 Context Stuffing 引擎：FTS5 搜尋 → top-K 選取
- [x] 5.4 實作 RAG prompt 組裝（system prompt + file context + session history + user query）
- [x] 5.5 整合 withStreamRetry() 到所有 AI streaming 呼叫（自動換 key）
- [x] 5.6 實作 AI 好友系統：agents.ts（5 personas + master prompt）
- [x] 5.7 實作 diaryAnalyzer.ts（多 Agent 平行分析 + SSE orchestration）
- [x] 5.8 實作對話資料夾 CRUD
- [x] 5.9 讓共享選人摘要以實際選中的 agents 為準，避免下游 chat summary 與 selected agents 不一致
- [x] 5.10 對明確的 concise reply 指令改走 answer-only synthesis，避免被多 agent 格式覆蓋
- [x] 5.11 對實用推薦/找答案型 chat 補 direct-answer routing，避免 `給我答案` 仍停在陪聊模式
- [x] 5.12 擴充 practical-answer routing 到 how-to 建議與二選一比較問題，避免 `推薦我怎麼...` / `選一個` 仍停在陪聊模式
- [x] 5.13 補 practical wording variants（如 `選哪個`、`怎麼和...談比較好`），並保留 generic emotional `怎麼辦` 在 reflective path

## 6. Frontend / 前端 UI

- [x] 6.1 建立共用 layout：sidebar 導覽、header、繁體中文 UI
- [x] 6.2 建立 API client 層（fetch wrapper + error handling）
- [x] 6.3 實作 Dashboard 頁面（統計、最近日記、標籤雲、AI 好友團隊、快速操作）
- [x] 6.4 實作檔案管理頁面（拖拽上傳、AI 摘要、重新分析）
- [x] 6.5 實作日記頁面（三欄 ChatGPT 佈局、資料夾、標籤、mood、多 Agent thinking UI）
- [x] 6.6 實作 AI 對話頁面（session 列表、資料夾、多 Agent thinking、SSE streaming）
- [x] 6.7 實作搜尋頁面（統一搜尋、來源篩選、highlight、標籤顯示）
- [x] 6.8 實作設定頁面（API key 管理、新增/刪除/批次匯入、usage 圖表）
- [x] 6.9 新增 Playwright live-only UI smoke tests，涵蓋 guest 導覽／保護頁 redirect 與 chat concise reply UX
- [x] 6.10 擴充 Playwright live-only UI smoke tests，涵蓋 guest files page/search UI 與 mobile guest navigation
- [x] 6.11 新增 Playwright live smoke test 驗證更新日誌 modal 會顯示最新版本與摘要

## 7. Integration / 整合部署

- [x] 7.1 Docker build 成功（arm64 Alpine）
- [x] 7.2 部署到 RPi：docker compose up
- [x] 7.3 更新 Caddy config：diary.sisihome.org + diary.sisihome（含 flush_interval -1 for SSE）
- [x] 7.4 更新 CLAUDE.md URL routing table
- [ ] 7.5 端到端驗證：API key 配額恢復後全功能測試
- [x] 7.6 圖片/附件上傳整合到日記（日記內嵌圖片 + AI 分析）
- [x] 7.7 使用 Playwright 直接對 live server 驗證 guest navigation 與 concise chat reply UI 流程
