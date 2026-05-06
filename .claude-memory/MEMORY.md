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
- Practical recommendation or utility queries (for example `晚餐吃什麼`, `推薦`, `幫我選`) must override reflective chat mode and produce direct answers. Follow-up pushes like `給我答案` or `直接說結論` should only switch to direct-answer mode when the immediately preceding user turn is already practical.
- Practical direct-answer mode also covers explicit comparison/choice queries (for example `火鍋跟拉麵選一個`) and actionable how-to requests (for example `推薦我怎麼跟主管溝通`).
- Practical direct-answer mode should also recognize common wording variants like `火鍋或拉麵選哪個`, `火鍋跟拉麵選哪個`, and `怎麼和主管談比較好`, while still leaving generic emotional `怎麼辦` on the reflective path.
- Practical mode now prioritizes a stable direct-answer path over multi-agent execution, so practical questions should never degrade into empty persona shells like `（暫時無法回應）`.
- Practical refinement follow-ups such as `預算低一點`, `不要排隊`, `近一點`, `附理由`, and `直接給唯一答案` should inherit the previous practical answer context instead of falling back to reflective chat.
- When users explicitly say `不要安慰我` or ask emotional contexts to `給我答案`, the system should switch to direct-advice mode; if the user has not provided a concrete topic yet, the assistant should ask for the topic directly instead of guessing.
- Chat turns must run AI response-mode analysis before route-specific synthesis. The analyzer reads the current message, session title, recent history, memory hints, RAG context, and image context, then chooses `reflective`, `planning`, `practical`, `directive_advice`, or `support_action`; regex routing is only a failure fallback.
- Persist chat intent observability in `dispatch_reason`: include response mode, whether it came from AI or fallback, confidence when available, safety concern when present, and the analyzer's brief rationale so routing failures can be diagnosed from saved messages/API responses.
- Playwright E2E is configured as explicit live-only smoke coverage: callers must set `LIVE_BASE_URL`, and the current suite covers guest navigation/protected diary redirect, guest chat concise-reply UX, guest files page/search UI flows, mobile guest sidebar navigation, and practical-vs-reflective chat boundary cases.
- Release notes are static frontend data in `packages/web/src/version.ts`; every user-visible release needs `APP_VERSION`, `RELEASE_NOTES`, the root `package.json`, and both workspace `package.json` versions bumped together.
- After the user has clearly told the agent to continue, the agent should not pause to ask whether to proceed again within the same execution thread.

## Toolchain (added 2026-04-07)

- **ESLint:** `eslint.config.mjs` — `typescript-eslint` strict + React rules + Prettier compat
- **Prettier:** `.prettierrc` — single quotes, 100 cols, LF, trailing commas
- **Scripts:** `npm run lint` · `npm run lint:fix` · `npm run format` · `npm run format:check`
