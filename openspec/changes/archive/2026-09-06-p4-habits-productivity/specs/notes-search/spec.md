# Notes Search Specification

## Purpose
Manage personal notes with pinning capabilities and full-text search for rapid retrieval.

## Requirements

### Requirement: Note CRUD & Pinning
The system SHALL provide endpoints to create, read, update, and delete notes.
- Notes MUST belong to a `user_id`.
- Notes SHALL have an `is_pinned` boolean flag.

#### Scenario: Pin Note
- GIVEN an existing note
- WHEN setting `is_pinned` to true
- THEN the system SHALL return 200 OK

### Requirement: Full-Text Search
The system SHALL provide a search endpoint using `plainto_tsquery` on a generated `search_tsv` column.
- Search MUST use the `simple` dictionary.
- Results MUST be ordered by `is_pinned DESC`, then `updated_at DESC`.
- Empty search queries MUST return all notes for the user.

#### Scenario: Basic Search
- GIVEN notes containing "project plan" and "shopping list"
- WHEN searching for "project"
- THEN the system SHALL return the "project plan" note

#### Scenario: Pinned Priority
- GIVEN Note A (unpinned, newer) and Note B (pinned, older)
- WHEN searching for a term appearing in both
- THEN the system SHALL return Note B first

#### Scenario: Empty Query
- GIVEN a set of notes
- WHEN sending an empty search string
- THEN the system SHALL return all notes ordered by pin and date

### Requirement: Validation
- Notes MUST NOT exceed a reasonable character limit (e.g., 1MB) to prevent DOS.

#### Scenario: Oversized Note
- GIVEN a note content exceeding the limit
- WHEN attempting to create it
- THEN the system MUST return 422 Unprocessable Entity
