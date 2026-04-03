## ADDED Requirements

### Requirement: File upload
The system SHALL accept file uploads via multipart form data. Supported formats: PDF, PNG, JPG, JPEG, GIF, TXT, MD. Maximum file size SHALL be 50MB.

#### Scenario: Successful file upload
- **WHEN** user uploads a valid PDF file (< 50MB)
- **THEN** system stores the file in `data/uploads/`, creates a `files` record, and returns the file metadata with id

#### Scenario: Unsupported file type
- **WHEN** user uploads a .exe file
- **THEN** system rejects with 400 error and message indicating supported formats

#### Scenario: File too large
- **WHEN** user uploads a 60MB file
- **THEN** system rejects with 413 error

### Requirement: File text extraction
The system SHALL extract text content from uploaded files automatically. PDF files use pdf-parse; image files use Gemini vision OCR; text files are read directly. Extracted text SHALL be stored in `files.content_text`.

#### Scenario: PDF text extraction
- **WHEN** a PDF file is uploaded
- **THEN** system extracts text using pdf-parse and stores in content_text

#### Scenario: Image OCR via Gemini
- **WHEN** a PNG/JPG image is uploaded
- **THEN** system sends to Gemini vision for OCR and stores extracted text in content_text

#### Scenario: PDF extraction failure fallback
- **WHEN** pdf-parse fails to extract text from a PDF
- **THEN** system falls back to Gemini vision for text extraction

### Requirement: AI file summary
The system SHALL generate an AI summary for each uploaded file using Gemini 2.5 Flash. The summary SHALL be stored in `files.ai_summary`.

#### Scenario: Auto-summary on upload
- **WHEN** a file is uploaded and text extraction completes
- **THEN** system sends extracted text to Gemini and stores the AI-generated summary

#### Scenario: Summary regeneration
- **WHEN** user requests re-summarization for a file
- **THEN** system re-sends content to Gemini and updates ai_summary

### Requirement: File listing and deletion
The system SHALL provide APIs to list all files (with pagination) and delete individual files.

#### Scenario: List files with pagination
- **WHEN** user requests file list with page=2, limit=20
- **THEN** system returns up to 20 files sorted by created_at DESC, with total count

#### Scenario: Delete file
- **WHEN** user deletes a file by id
- **THEN** system removes the DB record, the physical file from uploads/, and the FTS5 index entry

### Requirement: File FTS indexing
The system SHALL index file content_text and filename into the `files_fts` FTS5 virtual table upon upload, and remove the index entry upon deletion.

#### Scenario: File indexed after upload
- **WHEN** a file upload completes with extracted text
- **THEN** the content_text and filename are inserted into files_fts

#### Scenario: FTS entry removed on delete
- **WHEN** a file is deleted
- **THEN** the corresponding files_fts entry is removed
