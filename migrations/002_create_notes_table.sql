-- Migration to create the notes table
CREATE TABLE notes (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FULLTEXT (title, content) -- For search indexing
);

CREATE INDEX idx_notes_user_id ON notes(user_id); -- Optimizes queries by user_id