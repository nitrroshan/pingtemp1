-- Migration: Add full-text search index to notes table

-- Add a GIN index for full-text search on title and content columns
CREATE INDEX notes_full_text_search_idx ON notes USING gin (to_tsvector('english', title || ' ' || content));