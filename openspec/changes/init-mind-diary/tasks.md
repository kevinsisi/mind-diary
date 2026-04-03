## 1. Infrastructure / 專案初始化

- [ ] 1.1 初始化 monorepo：root package.json (workspaces)、tsconfig.json、.gitignore
- [ ] 1.2 初始化 packages/server：package.json、tsconfig.json、Express entry point
- [ ] 1.3 初始化 packages/web：Vite + React + TypeScript scaffold
- [ ] 1.4 建立 Dockerfile（multi-stage: build TS + bundle frontend → runtime）
- [ ] 1.5 建立 docker-compose.yml（port 8823、volume mounts for data/）
- [ ] 1.6 建立 .env.example（GEMINI_API_KEYS, PORT, DATABASE_PATH）

## 2. Database / 資料庫

- [ ] 2.1 安裝 better-sqlite3 + drizzle-orm + drizzle-kit
- [ ] 2.2 定義 Drizzle schema：files, diary_entries, chat_sessions, chat_messages
- [ ] 2.3 定義 Drizzle schema：api_keys, api_key_cooldowns, api_key_usage
- [ ] 2.4 建立 FTS5 虛擬表：files_fts, diary_fts（中文 tokenizer 配置）
- [ ] 2.5 建立 migration 腳本 + 自動 migrate on startup

## 3. Key Pool / AI 金鑰池

- [ ] 3.1 從 project-bridge 複製 keyPool.ts 並適配（key CRUD、Fisher-Yates、cooldown 查詢）
- [ ] 3.2 從 project-bridge 複製 geminiRetry.ts 並適配（withGeminiRetry、錯誤分級 cooldown）
- [ ] 3.3 從 project-bridge 複製 batchCaller.ts 並適配（createBatchCaller）
- [ ] 3.4 實作 key management REST API：GET/POST/DELETE /api/settings/keys
- [ ] 3.5 實作 batch import + batch validate endpoints
- [ ] 3.6 實作 usage tracking（api_key_usage 記錄 + 統計 API）
- [ ] 3.7 實作 ENV key 載入（GEMINI_API_KEYS 解析 + startup load）

## 4. Backend API / 後端核心

- [ ] 4.1 實作檔案上傳 API：POST /api/files（multer + 格式驗證 + 大小限制）
- [ ] 4.2 實作檔案文字抽取 service（pdf-parse + 純文字讀取）
- [ ] 4.3 實作圖片 OCR service（Gemini vision API）
- [ ] 4.4 實作 AI 檔案摘要 service（上傳後自動觸發）
- [ ] 4.5 實作檔案 CRUD API：GET /api/files、DELETE /api/files/:id
- [ ] 4.6 實作檔案 FTS5 索引（上傳時 insert、刪除時 remove）
- [ ] 4.7 實作日記 CRUD API：GET/POST/PUT/DELETE /api/diary
- [ ] 4.8 實作 AI 日記反思 service（建立時自動觸發、支援 mood context）
- [ ] 4.9 實作日記 FTS5 索引（CRUD 同步更新）
- [ ] 4.10 實作統一搜尋 API：GET /api/search（FTS5 query + highlight + 分頁）

## 5. AI Agent / 對話系統

- [ ] 5.1 實作 chat session CRUD API：GET/POST/DELETE /api/chat/sessions
- [ ] 5.2 實作 chat message API：POST /api/chat/sessions/:id/messages
- [ ] 5.3 實作 Context Stuffing 引擎：FTS5 搜尋 → top-K 選取 → token 計數截斷
- [ ] 5.4 實作 RAG prompt 組裝（system prompt + file context + session history + user query）
- [ ] 5.5 整合 withGeminiRetry() 到所有 AI 呼叫（摘要、反思、對話）
- [ ] 5.6 實作 session history 截斷（token budget 管理）

## 6. Frontend / 前端 UI

- [ ] 6.1 建立共用 layout：sidebar 導覽、header、繁體中文 UI
- [ ] 6.2 建立 API client 層（fetch wrapper + error handling）
- [ ] 6.3 實作 Dashboard 頁面（最近檔案、日記、對話摘要）
- [ ] 6.4 實作檔案管理頁面（上傳、列表、搜尋、AI 摘要顯示）
- [ ] 6.5 實作日記頁面（撰寫、時間軸列表、AI 反思顯示、mood 選擇）
- [ ] 6.6 實作 AI 對話頁面（session 列表、聊天 UI、markdown 渲染）
- [ ] 6.7 實作搜尋頁面（統一搜尋、結果 highlight、來源標示）
- [ ] 6.8 實作設定頁面（API key 管理、新增/刪除/封鎖、usage 圖表）

## 7. Integration / 整合部署

- [ ] 7.1 本地端到端測試：上傳檔案 → AI 摘要 → 搜尋 → 對話引用
- [ ] 7.2 Docker build 測試（本地 docker compose up）
- [ ] 7.3 部署到 RPi：push image / docker compose up
- [ ] 7.4 更新 Caddy config：新增 vault.sisihome.org + vault.sisihome 規則
- [ ] 7.5 更新 CLAUDE.md URL routing table（新增 vault.sisihome.org 條目）
- [ ] 7.6 端到端驗證：HTTPS 訪問 vault.sisihome.org 全功能測試
