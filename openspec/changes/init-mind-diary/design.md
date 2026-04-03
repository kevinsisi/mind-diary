## Context

Mind Diary 是全新專案，目前 repo 為空。目標是在 RPi 上部署一個個人知識庫服務，整合 AI 對話、檔案管理、日記功能。參考 project-bridge 已驗證的 key-pool 架構，以及 claude-code-agent-analysis 中的 agent 設計準則。

單人使用，無需認證系統。所有資料存 SQLite，AI 用 Gemini 2.5 Flash。

## Goals / Non-Goals

**Goals:**
- 建立可獨立部署的 monorepo（server + web）
- 實現 production-grade 的 Gemini key pool（對齊 project-bridge 水準）
- 提供檔案上傳 → AI 分析 → RAG 對話的完整流程
- 中文全文搜尋（FTS5）
- Docker 一鍵部署

**Non-Goals:**
- 多用戶、權限、認證
- Vector database / embedding
- 即時通知、WebSocket push
- 行動端 app

## Decisions

### 1. Monorepo 結構

```
mind-diary/
├── packages/
│   ├── server/          # Express + SQLite
│   │   ├── src/
│   │   │   ├── db/           # Drizzle schema + migrations
│   │   │   ├── routes/       # REST API routes
│   │   │   ├── services/     # Business logic
│   │   │   ├── ai/           # Gemini agent + key pool
│   │   │   └── index.ts      # Entry point
│   │   └── package.json
│   └── web/             # React + Vite
│       ├── src/
│       │   ├── components/
│       │   ├── pages/
│       │   ├── hooks/
│       │   └── api/          # API client
│       └── package.json
├── docker-compose.yml
├── Dockerfile
└── package.json         # Workspace root
```

**Why not Next.js?** Express + 獨立 React 更輕量，RPi 資源有限。project-bridge 已驗證此模式穩定。

### 2. SQLite + Drizzle ORM

- 單檔案資料庫，備份簡單（cp 即可）
- better-sqlite3 同步 API，避免 RPi 上的 async overhead
- Drizzle ORM 提供 type-safe schema + migration
- FTS5 虛擬表做中文全文搜尋

**Tables:**
- `files` — id, filename, mimetype, size, content_text, ai_summary, created_at
- `diary_entries` — id, title, content, ai_reflection, mood, created_at, updated_at
- `chat_sessions` — id, title, created_at
- `chat_messages` — id, session_id, role, content, created_at
- `api_keys` — id, key, source, suffix, is_blocked, created_at
- `api_key_cooldowns` — id, key_id, reason, expires_at, created_at
- `api_key_usage` — id, key_id, model, tokens_in, tokens_out, created_at
- `files_fts` — FTS5 virtual table on files.content_text + files.filename
- `diary_fts` — FTS5 virtual table on diary_entries.content + diary_entries.title

### 3. AI 架構：Context Stuffing RAG

```
User Query
    │
    ▼
┌─────────────┐     ┌──────────────┐
│  FTS5 Search │────▶│ Top-K Results │
│  (pre-filter)│     │ (files+diary) │
└─────────────┘     └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Context Build │
                    │ (stuff into   │
                    │  prompt)      │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Gemini 2.5   │
                    │ Flash (1M)   │
                    └──────────────┘
```

**Why not vector DB?** Gemini 2.5 Flash 有 1M token context window，對個人知識庫規模（< 10K 文件）直接塞進去就好。FTS5 預篩選確保只塞相關內容。省去維護 embedding pipeline 的複雜度。

### 4. Key Pool（複製 project-bridge 架構）

直接複製 project-bridge 的 key-pool 模組並適配：

- `ai/keyPool.ts` — key 管理、Fisher-Yates shuffle、cooldown 查詢
- `ai/geminiRetry.ts` — `withGeminiRetry()` wrapper、錯誤分級 cooldown
- `ai/batchCaller.ts` — `createBatchCaller()` 並行分配
- `routes/settings.ts` — 7 個管理 API endpoints（CRUD + batch import + validate）

Cooldown 策略（對齊 project-bridge）：
| 錯誤碼 | Cooldown | 說明 |
|--------|----------|------|
| 429 | 2 min | Rate limit |
| 401/403 | 30 min | Invalid/revoked key |
| 5xx | 30 sec | Server error |

### 5. 檔案處理

- 上傳存到 `data/uploads/` 目錄（Docker volume mount）
- PDF：用 pdf-parse 抽取文字
- 圖片：傳給 Gemini vision 做 OCR + 描述
- 文字檔：直接讀取
- 上傳後自動觸發 AI 分析產生摘要，存入 `files.ai_summary`

### 6. 前端路由

| 路由 | 頁面 | 說明 |
|------|------|------|
| `/` | Dashboard | 最近檔案、日記、對話 |
| `/files` | 檔案管理 | 上傳、列表、搜尋、AI 摘要 |
| `/diary` | 日記 | 寫日記、AI 反思、時間軸 |
| `/chat` | AI 對話 | RAG 聊天、session 管理 |
| `/search` | 搜尋 | 跨檔案+日記統一搜尋 |
| `/settings` | 設定 | API key 管理 |

## Risks / Trade-offs

- **[RPi 效能]** SQLite FTS5 + 大量文件可能拖慢搜尋 → Mitigation: FTS5 本身很快，加上 LIMIT 和分頁
- **[Context 爆掉]** 搜尋結果太多塞不進 1M → Mitigation: Top-K 限制 + token 計數截斷
- **[PDF 解析品質]** pdf-parse 對中文 PDF 支援不穩定 → Mitigation: 失敗時 fallback 到 Gemini vision
- **[Key Pool 維護]** 複製而非共用 package → Mitigation: 先複製求速度，長期考慮抽 npm package
- **[SQLite 並發]** better-sqlite3 同步 API 在高併發下可能阻塞 → 單人使用不成問題

## Migration Plan

1. 建立專案結構 + 安裝依賴
2. 實作 DB schema + key pool
3. 實作後端 API
4. 實作前端 UI
5. Docker 化 + 部署到 RPi
6. 更新 Caddy config 加入 vault.sisihome.org

Rollback: `docker compose down` 即可，不影響其他服務。
