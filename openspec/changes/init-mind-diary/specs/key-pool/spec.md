## Migration Note

> **已遷移至 @kevinsisi/ai-core**
>
> 本規格描述的 Key Pool 功能已透過 `@kevinsisi/ai-core` 套件實作。
> - Adapter 位置：`packages/server/src/ai/mindDiaryAdapter.ts`（實作 `StorageAdapter` 介面）
> - 套件來源：https://github.com/kevinsisi/ai-core
> - 安裝：`npm install github:kevinsisi/ai-core`
>
> 下方需求反映規格設計意圖；實際實作細節請參閱 adapter 原始碼。

## ADDED Requirements

### Requirement: Key CRUD with DB and ENV sources
The system SHALL manage Gemini API keys from two sources: database (user-added) and environment variable (GEMINI_API_KEYS, comma-separated). ENV keys can be blocked but not deleted.

#### Scenario: Add key via API
- **WHEN** admin adds a new API key via POST /api/settings/keys
- **THEN** system validates format (AIza prefix, length >= 20), stores in DB, and returns key metadata with suffix

#### Scenario: ENV keys loaded on startup
- **WHEN** server starts with GEMINI_API_KEYS="key1,key2"
- **THEN** system loads both keys into the pool with source="env"

#### Scenario: Block ENV key
- **WHEN** admin blocks an ENV-sourced key
- **THEN** key is marked blocked and excluded from rotation, but not deleted from pool

#### Scenario: Duplicate key rejected
- **WHEN** admin adds a key that already exists in the pool
- **THEN** system rejects with 409 conflict error

### Requirement: Key rotation with Fisher-Yates shuffle
The system SHALL select keys using random selection with Fisher-Yates shuffle for batch allocation, skipping keys in cooldown.

#### Scenario: Single key selection
- **WHEN** a Gemini API call is needed
- **THEN** system selects a random available key (not in cooldown, not blocked)

#### Scenario: Batch key allocation
- **WHEN** multiple parallel API calls are needed
- **THEN** system uses Fisher-Yates shuffle to distribute unique keys across calls

#### Scenario: All keys in cooldown
- **WHEN** all keys are in cooldown
- **THEN** system returns all keys anyway (graceful degradation)

### Requirement: Error-graded cooldown with DB persistence
The system SHALL apply different cooldown durations based on error type, persisted to the api_key_cooldowns table.

#### Scenario: Rate limit (429)
- **WHEN** a key receives a 429 response
- **THEN** key enters 2-minute cooldown, recorded in DB

#### Scenario: Invalid key (401/403)
- **WHEN** a key receives a 401 or 403 response
- **THEN** key enters 30-minute cooldown, recorded in DB

#### Scenario: Server error (5xx)
- **WHEN** a key receives a 500/502/503 response
- **THEN** key enters 30-second cooldown, recorded in DB

#### Scenario: Cooldown survives restart
- **WHEN** server restarts while keys are in cooldown
- **THEN** cooldown state is restored from DB, unexpired cooldowns remain active

### Requirement: Auto-retry wrapper
The system SHALL provide a `withGeminiRetry()` wrapper that automatically retries failed API calls with a different key.

#### Scenario: Retry on rate limit
- **WHEN** a Gemini call fails with 429
- **THEN** system puts the key in cooldown, selects a new key, and retries (up to max retries)

#### Scenario: Max retries exhausted
- **WHEN** retries are exhausted without success
- **THEN** system throws a descriptive error with the last error details

### Requirement: Key management REST API
The system SHALL expose REST endpoints for key management: list, add, delete, block/unblock, batch import, batch validate, and usage statistics.

#### Scenario: List keys with usage
- **WHEN** GET /api/settings/keys is called
- **THEN** system returns all keys with suffix, source, status, cooldown state, and usage stats (today/7d/30d)

#### Scenario: Batch validate keys
- **WHEN** POST /api/settings/validate-keys is called with an array of keys
- **THEN** system tests each key against Gemini API and returns validation results

### Requirement: Usage tracking
The system SHALL track API key usage including key suffix, model, input tokens, and output tokens per call.

#### Scenario: Usage recorded after successful call
- **WHEN** a Gemini API call succeeds
- **THEN** system records key_id, model, tokens_in, tokens_out in api_key_usage

#### Scenario: Usage statistics query
- **WHEN** admin queries usage for a specific period
- **THEN** system returns per-key aggregated token counts for today/7d/30d
