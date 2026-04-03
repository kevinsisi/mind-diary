## ADDED Requirements

### Requirement: Chat session management
The system SHALL support multiple chat sessions. Each session has a title and list of messages with role (user/assistant) and content.

#### Scenario: Create new chat session
- **WHEN** user starts a new chat
- **THEN** system creates a session with auto-generated title and returns session id

#### Scenario: List chat sessions
- **WHEN** user requests session list
- **THEN** system returns sessions sorted by most recent message, with last message preview

#### Scenario: Delete chat session
- **WHEN** user deletes a session
- **THEN** system removes the session and all associated messages

### Requirement: RAG chat with context stuffing
The system SHALL answer user queries by: (1) searching files and diary via FTS5 for relevant content, (2) stuffing top-K results into the Gemini prompt as context, (3) generating an answer with Gemini 2.5 Flash.

#### Scenario: Chat with relevant files found
- **WHEN** user sends "我的旅行計畫是什麼？" and FTS5 finds matching file content
- **THEN** system includes matched file excerpts in the Gemini prompt and returns a contextual answer

#### Scenario: Chat with no relevant context
- **WHEN** user sends a query and FTS5 returns no matches
- **THEN** system sends the query to Gemini without file context, and Gemini answers based on general knowledge

#### Scenario: Context token limit
- **WHEN** FTS5 returns results exceeding a configurable token budget (default: 500K tokens)
- **THEN** system truncates to top-K most relevant results to fit within budget

### Requirement: Cross-file AI memory
The system SHALL maintain conversation history within a session. Previous messages in the session SHALL be included in the Gemini prompt to enable multi-turn conversation.

#### Scenario: Multi-turn conversation
- **WHEN** user asks a follow-up question in an existing session
- **THEN** system includes prior messages from the session in the prompt, enabling Gemini to reference earlier context

#### Scenario: Session history truncation
- **WHEN** session history + context exceeds token budget
- **THEN** system truncates older messages first, preserving recent conversation and file context

### Requirement: Chat message persistence
The system SHALL persist all chat messages (user and assistant) to the database.

#### Scenario: Messages saved after exchange
- **WHEN** user sends a message and receives a response
- **THEN** both the user message and assistant response are stored in chat_messages with timestamps
