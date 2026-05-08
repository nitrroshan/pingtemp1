-- Create notes table
CREATE TABLE notes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    title VARCHAR(255),
    content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Add index for title
CREATE INDEX idx_notes_title ON notes (title);

-- Add full-text index for content (PostgreSQL example)
CREATE INDEX idx_notes_content_fulltext ON notes USING gin (to_tsvector('english', content));