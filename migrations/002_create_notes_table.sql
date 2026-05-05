-- Migration: Create notes table
CREATE TABLE notes (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for search
CREATE INDEX idx_notes_title ON notes USING gin (to_tsvector('english', title));
CREATE INDEX idx_notes_content ON notes USING gin (to_tsvector('english', content));