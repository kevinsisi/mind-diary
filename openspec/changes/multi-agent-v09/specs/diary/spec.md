## ADDED Requirements

### Requirement: Diary folder/category selection
The system SHALL support assigning diary entries to named folders, matching the same folder concept as chat sessions.

#### Scenario: Assign diary to folder on create
- **WHEN** user creates a diary entry with a folder_id
- **THEN** entry is stored with the given folder_id

#### Scenario: List diary entries by folder
- **WHEN** GET /api/diary?folder_id=3 is called
- **THEN** only entries with folder_id=3 are returned

#### Scenario: Diary multi-agent pipeline (AI reflection)
- **WHEN** a diary entry is submitted for AI reflection
- **THEN** system uses the same multi-agent pipeline as chat: `selectAgentsWithAI` selects 2–4 agents, agents run in parallel, master synthesizer produces final reflection, and auto-tags are generated

#### Scenario: Diary AI intent event
- **WHEN** diary analysis starts
- **THEN** an `intent` SSE event is emitted listing which agents were selected and why, same format as chat

#### Scenario: Image attachment to diary entry
- **WHEN** user uploads an image with a diary entry
- **THEN** image is stored on disk, Gemini Vision analyzes it, and the image description is provided as context to all agents
