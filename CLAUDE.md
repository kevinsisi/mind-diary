# Mind Diary — Claude Code Guide

## Project Overview

AI 心靈日記 — a multi-agent emotional wellness journaling app powered by 13 AI personas backed by Google Gemini.

- **Production:** `diary.sisihome.org:8823`
- **Version:** 0.18.9
- **Stack:** Express + TypeScript + SQLite (server) · React + Vite + Tailwind (web)
- **Monorepo:** npm workspaces (`packages/server`, `packages/web`)

## Repository Layout

```
mind-diary/
├── packages/
│   ├── server/          # Express API, port 8823
│   │   └── src/
│   │       ├── ai/      # 13 agents, Gemini client, key pool, retry logic
│   │       ├── db/      # Drizzle ORM schema + SQLite migrations
│   │       ├── routes/  # REST + SSE endpoints
│   │       ├── services/
│   │       ├── middleware/
│   │       └── types/
│   └── web/             # React 19 + Vite 6
│       └── src/
│           ├── pages/   # Chat, Diary, Dashboard, Files, Search, Settings
│           ├── components/
│           ├── context/ # AuthContext, ThemeContext, SiteConfigContext
│           └── api/     # client.ts — centralized fetch wrapper
├── Dockerfile           # Multi-stage build → linux/arm64
├── docker-compose.yml
└── .github/workflows/   # docker-publish.yml → deploy.yml
```

## 13 AI Agents (`packages/server/src/ai/agents.ts`)

| ID | Name | Emoji | Role |
|---|---|---|---|
| `lele` | 樂樂 | 😄 | 正向鼓勵師 |
| `youyou` | 憂憂 | 🩵 | 情感陪伴者 |
| `nunu` | 怒怒 | 🔥 | 界線捍衛者 |
| `yanyan` | 厭厭 | 😒 | 品味守護者 |
| `jingjing` | 驚驚 | 😨 | 風險警報員 |
| `ajiao` | 阿焦 | 😰 | 焦慮疏導師 |
| `amu` | 阿慕 | 🌟 | 目標動力師 |
| `axiu` | 阿羞 | 🙈 | 社交陪伴者 |
| `afei` | 阿廢 | 🛋️ | 倦怠偵測師 |
| `nianjiunai` | 念舊嬤 | 👵 | 記憶珍藏師 |
| `awen` | 阿穩 | 🧘 | 情緒調節師 |
| `asi` | 阿思 | 🔍 | 自我覺察師 |
| `dran` | Dr.安 | 🏥 | 身心健康顧問 |

**Master Agent (整合者):** Synthesizes 2–3 selected agent responses into one cohesive reply.

### Agent Pipeline

```
User message
  → selectAgentsWithAI()      # Gemini picks 2–3 relevant agents
  → load user_memories        # user-scoped long-term memory hints
  → runChatAgent() × N        # Each agent responds independently
  → synthesizeChat()          # Master agent merges responses
  → SSE stream to client      # text/event-stream, data: <token>\n\n
```

## SSE Streaming

- **Endpoint:** `POST /api/chat/sessions/:id/message`
- **Response headers:** `Content-Type: text/event-stream`
- **Protocol:** `data: <token>` chunks, terminated by `data: [DONE]`
- **Client:** `Chat.tsx` handles incremental rendering

## Database (SQLite + Drizzle ORM)

- **Driver:** `better-sqlite3` (synchronous)
- **File:** `DATABASE_PATH` env var (default `./data/mind-diary.db`)
- **Schema:** `packages/server/src/db/schema.ts`
- **FTS5 search:** `GET /api/search/?q=<query>` — spans diary entries, diary image descriptions, chat content, and file content

| Table | Purpose |
|---|---|
| `users` | Auth (JWT cookie + bcrypt) |
| `diary_entries` | Journal entries, mood, AI reflection |
| `chat_sessions` | Conversation containers |
| `chat_messages` | Individual messages |
| `user_memories` | User-scoped cross-session memory hints |
| `files` | Uploads with PDF text extraction |
| `api_keys` | Gemini key pool |
| `api_key_cooldowns` | Rate-limit tracking |
| `api_key_usage` | Token usage per call |
| `settings` | Key-value config |

## API Reference

All routes require JWT cookie auth except `/api/auth/login`.

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user |
| GET/POST | `/api/diary/` | List / create entries |
| GET/PUT/DELETE | `/api/diary/:id` | Get / update / delete entry |
| PATCH | `/api/diary/:id/mood` | Update mood |
| POST | `/api/diary/:id/images/` | Upload image to entry |
| POST | `/api/chat/sessions` | Create session |
| GET | `/api/chat/sessions` | List sessions |
| GET | `/api/chat/sessions/:id/messages` | Get messages |
| **POST** | **`/api/chat/sessions/:id/message`** | **SSE** — send message |
| DELETE | `/api/chat/sessions/:id` | Delete session |
| GET/POST | `/api/files/` | List / upload files |
| GET | `/api/search/?q=` | FTS5 full-text search |
| GET/PUT | `/api/settings/` | User settings |
| GET/DELETE | `/api/settings/memories` | List / remove own long-term memories |
| GET/POST | `/api/settings/isolation-*` | Admin legacy isolation report / safe repair |

## Deployment

### Environment Variables

```env
GEMINI_API_KEYS=key1,key2,...   # comma-separated Gemini API keys
PORT=8823
DATABASE_PATH=./data/mind-diary.db
TZ=Asia/Taipei
```

### Docker

```bash
docker compose up -d            # run locally
docker build -t kevin950805/mind-diary:latest .   # manual build
```

- **Image:** `kevin950805/mind-diary:latest` (DockerHub)
- **Platform:** `linux/arm64`
- **Port:** 8823
- **Volume:** `/app/data` (SQLite DB + uploads)

### CI/CD (GitHub Actions)

1. Push to `main` → `docker-publish.yml` → build + push to DockerHub
2. On success → `deploy.yml` → Tailscale VPN → SSH → `docker compose pull && docker compose up -d`

Required secrets: `GEMINI_API_KEYS`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `DEPLOY_SERVER_IP`, `DEPLOY_SSH_KEY`, `DEPLOY_USER`, `DEPLOY_PATH`

## Development

```bash
npm install           # install all workspace deps
npm run dev           # hot-reload both packages concurrently
npm run build         # tsc + vite build
npm run lint          # ESLint (TypeScript strict)
npm run format        # Prettier
npm run format:check  # Prettier dry-run (used in CI)
```

## Constraints & Rules

- **DO NOT upgrade existing package versions** — add new packages only when necessary
- **DO NOT change port 8823** — hardcoded in deployment infrastructure and Tailscale routing
- **DO NOT rename agent IDs** — they are stored in `chat_messages.content` and used for rendering
- **DO NOT break the SSE protocol** — client parses `data: ` prefix and `[DONE]` sentinel exactly
- **DO NOT change the Docker image name** `kevin950805/mind-diary`
- **Schema changes require a Drizzle migration** — never alter tables directly
- **FTS5 is SQLite-native** — do not replace with an external search service
- **Auth uses JWT cookies** — never put tokens in URLs or response bodies
- **AI model is `gemini-2.5-flash`** — test key pool behavior before switching models
- **TypeScript strict mode is on** — no `any` without explicit justification comment
- **ESLint + Prettier are enforced** — run `npm run lint` and `npm run format` before committing
- Once the user has clearly said `繼續`, `go`, or otherwise explicitly told you to keep executing, do not stop to ask whether to continue; execute directly until the current task is finished.
