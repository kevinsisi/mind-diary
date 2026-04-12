## ADDED Requirements

### Requirement: Diary CRUD
The system SHALL provide full CRUD operations for diary entries. Each entry has title, content, mood (optional), created_at, and updated_at.

#### Scenario: Create diary entry
- **WHEN** user submits a new diary entry with title and content
- **THEN** system creates the entry and returns it with generated id and timestamps

#### Scenario: Fallback title is preserved on invalid AI title
- **WHEN** a diary entry is created without a title and the background AI title result is malformed, meta, or too short to be useful
- **THEN** system keeps the fallback title instead of overwriting it with a bad generated value

#### Scenario: Update diary entry
- **WHEN** user updates an existing diary entry's content
- **THEN** system updates the entry and sets updated_at to current time

#### Scenario: Delete diary entry
- **WHEN** user deletes a diary entry by id
- **THEN** system removes the DB record and corresponding FTS5 index entry

#### Scenario: List diary entries
- **WHEN** user requests diary list with pagination
- **THEN** system returns entries sorted by created_at DESC with total count

### Requirement: AI diary reflection
The system SHALL generate an AI reflection for diary entries using Gemini 2.5 Flash. The reflection SHALL offer empathetic insight, patterns, or gentle suggestions based on the diary content.

#### Scenario: Auto-reflection on create
- **WHEN** a new diary entry is created
- **THEN** system sends the entry content to Gemini for reflection and stores result in ai_reflection

#### Scenario: Reflection with mood context
- **WHEN** a diary entry includes a mood tag
- **THEN** the AI reflection prompt includes the mood as additional context

#### Scenario: Re-generate reflection
- **WHEN** user requests re-generation of reflection for an entry
- **THEN** system re-sends content to Gemini and updates ai_reflection

### Requirement: Diary FTS indexing
The system SHALL index diary title and content into the `diary_fts` FTS5 virtual table, and update/remove entries accordingly.

#### Scenario: Diary indexed after create
- **WHEN** a diary entry is created
- **THEN** title and content are inserted into diary_fts

#### Scenario: Diary FTS updated after edit
- **WHEN** a diary entry is updated
- **THEN** the diary_fts entry is updated to reflect new content

#### Scenario: Diary FTS removed on delete
- **WHEN** a diary entry is deleted
- **THEN** the corresponding diary_fts entry is removed
