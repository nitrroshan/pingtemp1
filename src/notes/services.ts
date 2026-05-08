import { db } from '../db';

// Service to create a new note
export async function createNote(userId: number, title: string, content: string): Promise<any> {
  const { rows } = await db.query(
    'INSERT INTO notes (user_id, title, content) VALUES ($1, $2, $3) RETURNING *',
    [userId, title, content]
  );
  return rows[0];
}

// Service to get all notes for a user
export async function getNotes(userId: number): Promise<any[]> {
  const { rows } = await db.query(
    'SELECT * FROM notes WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

// Service to get a note by ID
export async function getNoteById(userId: number, noteId: number): Promise<any | null> {
  const { rows } = await db.query(
    'SELECT * FROM notes WHERE id = $1 AND user_id = $2',
    [noteId, userId]
  );
  return rows[0] || null;
}

// Service to update a note by ID
export async function updateNote(userId: number, noteId: number, updates: { title?: string; content?: string }): Promise<any | null> {
  const fields = [];
  const values = [noteId, userId];
  
  if (updates.title) {
    fields.push('title = $' + (fields.length + 3));
    values.push(updates.title);
  }

  if (updates.content) {
    fields.push('content = $' + (fields.length + 3));
    values.push(updates.content);
  }

  if (fields.length === 0) return null;

  const { rows } = await db.query(
    `UPDATE notes SET ${fields.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
    values
  );

  return rows[0] || null;
}

// Service to delete a note by ID
export async function deleteNote(userId: number, noteId: number): Promise<boolean> {
  const { rowCount } = await db.query(
    'DELETE FROM notes WHERE id = $1 AND user_id = $2',
    [noteId, userId]
  );
  return rowCount > 0;
}