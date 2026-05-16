import { Pool } from 'pg';
import { Note } from '../types/note';

// Dependency injection for database pool
export class NotesService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // Create a new note
  async createNote(userId: string, title: string, content: string): Promise<Note> {
    const query = `
      INSERT INTO notes (user_id, title, content, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id, user_id, title, content, created_at, updated_at;
    `;

    const result = await this.pool.query(query, [userId, title, content]);
    return result.rows[0];
  }

  // Get all notes for a user
  async getNotesByUser(userId: string): Promise<Note[]> {
    const query = `
      SELECT id, user_id, title, content, created_at, updated_at
      FROM notes
      WHERE user_id = $1
      ORDER BY updated_at DESC;
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }

  // Get a single note by ID
  async getNoteById(userId: string, noteId: string): Promise<Note | null> {
    const query = `
      SELECT id, user_id, title, content, created_at, updated_at
      FROM notes
      WHERE user_id = $1 AND id = $2;
    `;

    const result = await this.pool.query(query, [userId, noteId]);
    return result.rows[0] || null;
  }

  // Update a note
  async updateNote(userId: string, noteId: string, title: string, content: string): Promise<Note | null> {
    const query = `
      UPDATE notes
      SET title = $3, content = $4, updated_at = NOW()
      WHERE user_id = $1 AND id = $2
      RETURNING id, user_id, title, content, created_at, updated_at;
    `;

    const result = await this.pool.query(query, [userId, noteId, title, content]);
    return result.rows[0] || null;
  }

  // Delete a note
  async deleteNote(userId: string, noteId: string): Promise<boolean> {
    const query = `
      DELETE FROM notes
      WHERE user_id = $1 AND id = $2;
    `;

    const result = await this.pool.query(query, [userId, noteId]);
    return result.rowCount > 0;
  }

  // Search notes using full-text search
  async searchNotes(userId: string, searchTerm: string): Promise<Note[]> {
    const query = `
      SELECT id, user_id, title, content, created_at, updated_at
      FROM notes
      WHERE user_id = $1 AND to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $2)
      ORDER BY updated_at DESC;
    `;

    const result = await this.pool.query(query, [userId, searchTerm]);
    return result.rows;
  }
}