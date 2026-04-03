## ADDED Requirements

### Requirement: Unified search
The system SHALL provide a unified search endpoint that queries both files and diary entries via FTS5 full-text search.

#### Scenario: Search across files and diary
- **WHEN** user searches for "旅行"
- **THEN** system queries both files_fts and diary_fts, returns combined results sorted by relevance with source type indicated

#### Scenario: Search with no results
- **WHEN** user searches for a term with no matches
- **THEN** system returns an empty result set with count 0

#### Scenario: Search pagination
- **WHEN** user searches with page=2, limit=10
- **THEN** system returns the second page of results with total count

### Requirement: Chinese FTS5 support
The system SHALL configure SQLite FTS5 with a tokenizer that supports Chinese text segmentation.

#### Scenario: Chinese character search
- **WHEN** user searches "知識管理"
- **THEN** system matches files/diary containing those Chinese characters

#### Scenario: Mixed language search
- **WHEN** user searches "API 設定"
- **THEN** system matches content containing both English "API" and Chinese "設定"

### Requirement: Search result highlighting
The system SHALL return search results with matched terms highlighted using FTS5 snippet() or highlight() functions.

#### Scenario: Highlighted snippets
- **WHEN** search returns results
- **THEN** each result includes a snippet with matched terms wrapped in highlight markers
