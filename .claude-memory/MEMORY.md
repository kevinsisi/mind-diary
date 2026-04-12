---
type: project
---

# Mind Diary — Project Memory

## Architecture Snapshot

- **Monorepo:** npm workspaces — `packages/server` (Express+TS) · `packages/web` (React+Vite)
- **Backend runtime:** Node 20 Alpine, port 8823
- **Frontend build:** Vite 6, served as SPA by Express from `packages/web/dist/`
- **Database:** SQLite via `better-sqlite3` + Drizzle ORM; FTS5 for full-text search
- **AI:** Google Gemini (`gemini-2.5-flash`) via `@kevinsisi/ai-core` key pool

## 13 Agents

IDs (stable — stored in DB): `lele`, `youyou`, `nunu`, `yanyan`, `jingjing`, `ajiao`, `amu`, `axiu`, `afei`, `nianjiunai`, `awen`, `asi`, `dran`

Master agent (整合者) synthesizes 2–3 selected agents per message.

## Key Files

| File                                      | Purpose                           |
| ----------------------------------------- | --------------------------------- |
| `packages/server/src/ai/agents.ts`        | Agent persona definitions         |
| `packages/server/src/ai/diaryAnalyzer.ts` | Agent selection + synthesis       |
| `packages/server/src/ai/geminiClient.ts`  | Gemini API wrapper                |
| `packages/server/src/ai/pool.ts`          | API key pool (rotation, cooldown) |
| `packages/server/src/routes/chat.ts`      | Chat endpoints + SSE streaming    |
| `packages/server/src/db/schema.ts`        | Drizzle schema (all tables)       |
| `packages/web/src/pages/Chat.tsx`         | Main chat UI with SSE rendering   |

## Deployment

- **Image:** `kevin950805/mind-diary:latest` (DockerHub, `linux/arm64`)
- **CI:** Push to `main` → build+push → Tailscale SSH → `docker compose up -d`
- **Secrets:** `GEMINI_API_KEYS` (comma-separated), DockerHub creds, Tailscale OAuth

## Hard Constraints

- Do not upgrade existing package versions
- Do not rename agent IDs (referenced in stored messages)
- Do not change port 8823
- Do not break SSE protocol (`data: <token>` / `data: [DONE]`)
- New schema changes should use Drizzle migrations; the auth profile columns (`nickname`, `custom_instructions`) are a legacy startup backfill exception for older databases.

## Product Behavior Notes

- Guest mode uses public-space data with `user_id = 0` for chat, files, search, and diary APIs; the `/diary` page itself remains login-gated in the frontend.
- Admin user deletion must reject removing the last remaining admin account; backend must enforce this even if the UI already expects the error state.
- Legacy `users` profile columns (`nickname`, `custom_instructions`) are backfilled once during server startup, not lazily during auth requests.
- Diary background title generation must keep the fallback title if Gemini returns a malformed/meta title such as a single token or label-like output.
- Shared multi-agent selection summaries must be derived from the actual selected agents so persisted summaries stay consistent with the selected agent list.
- Explicit concise reply directives in chat (for example `只回答一句`, `只回答代號`, `不要加其他文字`) should switch final synthesis into answer-only mode instead of forcing the normal multi-agent formatted reply.
- Playwright E2E is configured as explicit live-only smoke coverage: callers must set `LIVE_BASE_URL`, and the current suite covers guest navigation/protected diary redirect and guest chat concise-reply UX.

## Toolchain (added 2026-04-07)

- **ESLint:** `eslint.config.mjs` — `typescript-eslint` strict + React rules + Prettier compat
- **Prettier:** `.prettierrc` — single quotes, 100 cols, LF, trailing commas
- **Scripts:** `npm run lint` · `npm run lint:fix` · `npm run format` · `npm run format:check`
