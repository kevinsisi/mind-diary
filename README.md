# Mind Diary

多 Agent AI 日記平台 — 記錄你的思維，與 AI 深度對話。

**線上版：** https://diary.sisihome.org
**Port：** 8823

## 這是什麼？

Mind Diary 是一個私人 AI 日記應用，讓你以 Markdown 記錄日記，並透過 RAG（檢索增強生成）與 AI 進行有上下文的深度對話。

## 核心功能

- **日記管理** — Markdown 編輯器、資料夾、標籤分類
- **AI 聊天** — 基於 FTS5 全文搜尋的 RAG，AI 自動找到相關日記作為上下文
- **多 AI Agent** — 多個 Agent 協作分析你的日記
- **使用者記憶** — 每位使用者都有跨對話記憶，且可在設定頁查看與刪除，不同使用者完全隔離
- **多使用者隔離** — 對話資料夾、日記資料夾、圖片與標籤刪除都依 `user_id` 隔離
- **記憶提示** — 若對話讓跨對話記憶更新，回覆底部會淡淡提示「記憶已更新」
- **檔案管理** — 支援圖片、PDF 附件上傳
- **使用者系統** — JWT 認證、多使用者管理

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | React 19 + TypeScript + Vite |
| 後端 | Express + TypeScript |
| 資料庫 | SQLite (better-sqlite3) + FTS5 全文搜尋 |
| AI 模型 | Gemini 2.5 Flash |
| AI 基礎設施 | @kevinsisi/ai-core（Key Pool + 自動重試） |
| Monorepo | npm workspaces |
| CI/CD | GitHub Actions |

## @kevinsisi/ai-core 整合

本專案使用 [@kevinsisi/ai-core](https://github.com/kevinsisi/ai-core) 作為 Gemini API 金鑰管理的共用模組。

### 提供什麼

- **KeyPool** — 多金鑰輪替，遇到 429 quota 錯誤時自動換金鑰重試
- **GeminiClient** — 封裝 `@google/generative-ai`，自動分配金鑰、處理重試、追蹤 token 用量
- **withRetry** — 低階重試工具，根據錯誤類型（quota / rate-limit / network / fatal）採用不同策略

### StorageAdapter 模式

`KeyPool` 不綁定特定資料庫 — 透過 `StorageAdapter` 介面橋接到任意儲存後端。本專案實作了自己的 adapter：

**Adapter 位置：** `packages/server/src/ai/mindDiaryAdapter.ts`

Mind Diary 使用兩張表儲存金鑰狀態：

```
api_keys         (id, key, source, suffix, is_blocked)
api_key_cooldowns (id, key_id, reason, cooldown_until)
```

`MindDiaryAdapter` 將這個雙表結構映射到 ai-core 的 `ApiKey` 介面，讓 `KeyPool` 可以正確管理冷卻狀態和封鎖狀態，且冷卻資料在容器重啟後仍能保留。

### 使用方式

```ts
import { KeyPool, GeminiClient } from "@kevinsisi/ai-core";
import { MindDiaryAdapter } from "./mindDiaryAdapter.js";

const pool = new KeyPool(new MindDiaryAdapter());
const client = new GeminiClient(pool, { maxRetries: 3 });

const { text } = await client.generateContent({
  model: "gemini-2.5-flash",
  prompt: userMessage,
  systemInstruction: SYSTEM_PROMPT,
  history: previousMessages,
});
```

## 專案結構

```
mind-diary/
├── packages/
│   ├── server/                     # Express API 伺服器
│   │   └── src/
│   │       ├── ai/
│   │       │   └── mindDiaryAdapter.ts   # StorageAdapter 實作
│   │       ├── db/                       # SQLite 資料庫
│   │       ├── routes/                   # API 路由
│   │       └── services/                 # 業務邏輯
│   └── web/                        # React 前端
│       └── src/
│           ├── app/                      # 頁面
│           └── components/               # 元件
├── openspec/                       # 功能規格與任務追蹤
└── .github/workflows/              # CI/CD
```

## 快速開始

```bash
# 安裝依賴
npm install

# 設定環境變數 (packages/server/.env)
GEMINI_API_KEY=your-api-key
JWT_SECRET=your-secret

# 啟動開發伺服器
npm run dev
```

## 部署

```bash
# Docker Compose
docker compose up -d
# 服務在 port 8823
```
