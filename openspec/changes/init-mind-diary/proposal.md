## Why

Kevin 需要一個統一的個人知識庫，能上傳檔案、寫日記、並透過 AI 跨檔案理解和回答問題。現有的筆記散落在各處，沒有 AI 輔助的搜尋和反思功能。Mind Diary 作為部署在 RPi 上的私人服務，讓所有個人知識集中管理，並利用 Gemini 2.5 Flash 的 1M context window 實現無需 vector DB 的 RAG 對話。

## What Changes

- 建立全新 monorepo 專案（`packages/server` + `packages/web`）
- Express + SQLite 後端，提供檔案管理、日記、AI 對話 REST API
- React + Vite 前端，繁體中文 UI
- Gemini 2.5 Flash AI agent，複用 project-bridge 的 key-pool 架構（withGeminiRetry、cooldown 持久化、錯誤分級、Fisher-Yates batch）
- FTS5 全文搜尋（中文支援）+ Context Stuffing RAG
- Docker Compose 部署，port 8823，透過 Caddy 反向代理 at vault.sisihome.org

## Non-goals

- 不做多用戶/權限系統 — 這是單人私有服務
- 不使用 vector database — 靠 FTS5 預篩選 + Gemini 1M context 即可
- 不做即時協作或分享功能
- 不支援 IPv6

## Capabilities

### New Capabilities

- `file-management`: 檔案上傳（PDF、圖片、文字）、儲存、列表、刪除，AI 自動分析摘要
- `diary`: 私密日記 CRUD，支援 AI 反思回饋
- `ai-chat`: RAG 對話，跨檔案 AI 記憶，Context Stuffing 策略（FTS5 預篩 → Gemini 1M context）
- `search`: 中文模糊搜尋（SQLite FTS5），跨檔案和日記統一搜尋
- `key-pool`: Gemini API key pool，複用 project-bridge 架構（DB-backed cooldown、auto-retry、batch caller、管理 API）
- `docker-deploy`: Docker Compose 部署配置、Caddy 反向代理整合

### Modified Capabilities

（無 — 全新專案）

## Impact

- **新增 repo**: mind-diary（已建立，目前為空）
- **RPi 部署**: 新增 Docker container，佔用 port 8823
- **Caddy**: 需新增 vault.sisihome.org 反向代理規則
- **依賴**: @google/generative-ai、express、better-sqlite3、drizzle-orm、react、vite
- **Pi-hole DNS**: 已有 wildcard，無需額外設定
