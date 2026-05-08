-- Migration for creating the notes table
CREATE TABLE notes (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT,
    tags JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Full-text search index on title and content
CREATE INDEX notes_search_idx ON notes USING GIN (to_tsvector('english', title || ' ' || content));

-- JSONB GIN index for tags
CREATE INDEX notes_tags_idx ON notes USING GIN (tags);