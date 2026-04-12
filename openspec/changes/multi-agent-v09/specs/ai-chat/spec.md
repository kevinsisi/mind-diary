## ADDED Requirements

### Requirement: Multi-agent chat system with current persona roster
The system SHALL respond to chat messages using the current multi-agent pipeline: AI selects 2-4 persona agents from the live roster defined in `packages/server/src/ai/agents.ts`, each produces a response in parallel, then a final synthesizer merges all responses into a single reply.

The live roster currently contains 13 stable persona agents, and the stored agent IDs MUST stay aligned with `agents.ts`.

#### Scenario: Agent selection
- **WHEN** user sends a chat message
- **THEN** system calls `selectAgentsWithAI()` which sends the message to Gemini and receives a JSON list of 2–4 agent IDs with per-agent selection reasons and a summary explanation

#### Scenario: Selection summary matches actual agents
- **WHEN** agent selection is completed
- **THEN** the shared selection summary only describes the agents that were actually selected, so downstream chat events and persisted metadata remain consistent with the selected agent list

#### Scenario: Explicit concise reply directive bypasses persona formatting
- **WHEN** the user explicitly requires a short answer format such as `只回答一句話`, `只回答代號`, or `不要加其他文字`
- **THEN** final synthesis returns a single answer that follows the requested format, instead of the normal multi-agent persona layout

#### Scenario: Practical recommendation query prefers direct answer mode
- **WHEN** the user asks a practical utility question such as what to eat, which option to choose, or explicitly says `給我答案`
- **THEN** the system prioritizes direct-answer synthesis over reflective persona chat, and the follow-up turn can override earlier exploratory behavior

#### Scenario: Parallel agent execution
- **WHEN** agents are selected
- **THEN** system runs all agents concurrently via `Promise.all()`; each agent receives the user message, RAG context, and recent conversation history

#### Scenario: Master synthesis
- **WHEN** all agents complete
- **THEN** master synthesizer calls Gemini with all agent outputs and produces a final reply in each agent's voice, one paragraph per agent

#### Scenario: Agent failure does not block synthesis
- **WHEN** one agent throws an error
- **THEN** that agent's slot returns "（暫時無法回應）" and synthesis proceeds with remaining results

### Requirement: AI-based agent selection with thinkingBudget:0
The system SHALL use Gemini with `thinkingConfig: { thinkingBudget: 0 }` and `responseMimeType: 'application/json'` for agent selection to ensure structured JSON output without thinking-token truncation.

#### Scenario: JSON response mode
- **WHEN** `selectAgentsWithAI` calls Gemini
- **THEN** Gemini returns a valid JSON object `{ selected: [{id, reason}], summary }` with no extra text

#### Scenario: thinkingBudget:0 prevents truncation
- **WHEN** Gemini 2.5 Flash is used with thinking enabled and a short output budget
- **THEN** thinking tokens consume the output budget, truncating the JSON; `thinkingBudget:0` disables thinking and prevents this

#### Scenario: Fallback on parse failure
- **WHEN** JSON parsing fails or no valid agents are returned
- **THEN** system falls back to [小魚, 阿哲] as default agents with a generic summary

### Requirement: SSE event pipeline
The system SHALL stream chat progress to the client via Server-Sent Events. Each POST to `/api/chat/sessions/:id/messages` responds with `Content-Type: text/event-stream` and emits events in this order:

| Event type | When emitted |
|---|---|
| `phase` | Phase transitions (searching, analyzing-image, analyzing, thinking, synthesizing) |
| `intent` | After agent selection — includes agent list + reasons + summary |
| `agent-start` | When each agent begins processing |
| `agent-thinking` | Full agent response text (sent as single event) |
| `agent-done` | When each agent finishes, includes final content |
| `synthesizing` | Master synthesizer start + final content |
| `tags` | Diary: after tag generation |
| `done` | Diary: pipeline complete with reflection + tags |
| `complete` | Chat: pipeline complete with saved userMessage + assistantMessage |
| `title-updated` | After first-message title generation — includes sessionId + new title |
| `error` | On unrecoverable error |

#### Scenario: Heartbeat keeps connection alive
- **WHEN** SSE connection is held open for more than 15 seconds
- **THEN** server emits `: heartbeat` comment every 15 seconds to prevent proxy timeouts

#### Scenario: Aborted connection still saves to DB
- **WHEN** client disconnects before `complete` event
- **THEN** server completes synthesis and saves the assistant message to DB (for next page load to show)

### Requirement: Chat title auto-generation
The system SHALL generate a short title (≤ 10 Chinese characters) for a chat session after the first message is processed, using Gemini with `thinkingBudget:0` and `maxOutputTokens: 2048`.

#### Scenario: Title generated on first message
- **WHEN** user sends the first message in a new session
- **THEN** after AI response is generated, system calls Gemini with the user message + AI response as context and generates a title

#### Scenario: disableThinking prevents truncation
- **WHEN** Gemini 2.5 Flash thinking model is used for title generation
- **THEN** `thinkingBudget:0` is set so thinking tokens do not consume the output budget and truncate the title

#### Scenario: title-updated event before complete
- **WHEN** title is generated
- **THEN** `title-updated` SSE event is emitted before the `complete` event and `res.end()` so the client receives it

#### Scenario: Fallback title on failure
- **WHEN** title generation fails or returns empty string
- **THEN** system uses first 20 characters of user message as fallback title

### Requirement: Chat folder organization
The system SHALL support organizing chat sessions into named folders. Each session has an optional `folder_id`.

#### Scenario: Create folder
- **WHEN** POST /api/chat/folders is called with a name and optional icon
- **THEN** system creates the folder and returns it with id, name, icon, created_at

#### Scenario: List sessions by folder
- **WHEN** GET /api/chat/sessions?folder_id=5 is called
- **THEN** only sessions with folder_id=5 are returned

#### Scenario: List sessions without folder
- **WHEN** GET /api/chat/sessions?folder_id=null is called
- **THEN** only sessions with folder_id IS NULL are returned

#### Scenario: Delete folder moves sessions to unfiled
- **WHEN** a folder is deleted
- **THEN** sessions in that folder have their folder_id set to NULL before folder is removed

### Requirement: Image upload and display in chat
The system SHALL allow users to attach one image per chat message. Images are stored on disk, analyzed by Gemini Vision, and displayed in the chat UI.

#### Scenario: Image upload
- **WHEN** user sends a message with an attached image (PNG/JPEG/GIF/WebP, ≤ 10 MB)
- **THEN** image is stored in `/images/chat/` on disk and `image_url` is saved in `chat_messages`

#### Scenario: Image analysis as auxiliary context
- **WHEN** user sends both text and an image
- **THEN** system analyzes the image with Gemini Vision separately, stores result as `imagePart`, and provides it to agents and synthesizer as auxiliary information — the text question remains the primary intent

#### Scenario: Image displayed in chat UI
- **WHEN** chat messages are loaded
- **THEN** messages with `image_url` render the image inline above the text content

#### Scenario: Unsupported format rejected
- **WHEN** user attaches a non-image file (e.g., PDF)
- **THEN** upload is rejected with a 400-level error before processing begins

### Requirement: visibilitychange SSE reconnect
The system SHALL reconnect the SSE stream when the browser tab returns to focus, recovering from mobile connection drops.

#### Scenario: Reconnect on tab re-focus
- **WHEN** user switches away and back to the chat tab
- **THEN** frontend listens to `visibilitychange` event; if `document.visibilityState === 'visible'` and an active SSE connection was lost, it reconnects

### Requirement: react-markdown rendering
All AI-generated text responses SHALL be rendered with `react-markdown` to support bold, italic, lists, code blocks, and other Markdown formatting.

#### Scenario: Markdown rendered in chat
- **WHEN** AI response contains markdown syntax (e.g., `**bold**`, `- list item`)
- **THEN** chat UI renders it as formatted HTML, not raw markdown text

### Requirement: Shared callGeminiText utility
The system SHALL use a single shared `callGeminiText()` function (exported from `geminiRetry.ts`) for all non-streaming Gemini text generation calls. This replaces the former local `callGeminiWithRetry` in `chat.ts`.

`callGeminiText(systemPrompt, prompt, maxOutputTokens, options)` where options include: `maxRetries`, `callType`, `disableThinking`, `timeoutMs` (default 15000ms).

#### Scenario: Single implementation used by chat and diary
- **WHEN** chat or diary module needs non-streaming text generation
- **THEN** both import and call `callGeminiText` from `geminiRetry.ts`; there is no duplicate implementation
