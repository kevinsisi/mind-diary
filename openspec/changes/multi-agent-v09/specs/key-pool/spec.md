## ADDED Requirements

### Requirement: Shared callGeminiText wrapper in geminiRetry.ts
The system SHALL export `callGeminiText(systemPrompt, prompt, maxOutputTokens, options)` from `geminiRetry.ts` as the single shared utility for non-streaming Gemini API calls. This is the unified replacement for the former `callGeminiWithRetry` local function that existed in `chat.ts`.

Internals: calls `withGeminiRetry` with a configurable timeout (default 15 s), optional `thinkingBudget:0`, and automatic `trackUsageByKey` after each successful call.

#### Scenario: Unified call path
- **WHEN** any module needs a non-streaming Gemini text response
- **THEN** it imports and calls `callGeminiText` from `geminiRetry.ts`; retry, key rotation, timeout, thinking config, and usage tracking are all handled in one place

#### Scenario: disableThinking option
- **WHEN** `disableThinking: true` is passed in options
- **THEN** `thinkingConfig: { thinkingBudget: 0 }` is set on the model, preventing thinking-token budget from consuming output tokens

#### Scenario: Custom timeout
- **WHEN** `timeoutMs` is passed in options
- **THEN** the call times out after the specified duration instead of the default 15 seconds

### Requirement: Key pool size target of 50 valid keys
The system SHALL support up to 50 simultaneously active API keys. Keys can be added via DB (API) or ENV variable. Fisher-Yates shuffle ensures even distribution across keys for batch allocation.

#### Scenario: 50 keys in rotation
- **WHEN** 50 keys are loaded (DB + ENV combined)
- **THEN** all 50 participate in rotation; batch allocation distributes them evenly across parallel agent calls

#### Scenario: Key pool graceful degradation
- **WHEN** all keys are in cooldown simultaneously
- **THEN** system returns all keys anyway and attempts the call rather than failing immediately
