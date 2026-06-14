-- Migration to add full-text search index for notes table
CREATE INDEX notes_content_idx
ON notes USING gin (to_tsvector('english', content));