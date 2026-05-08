import { Request, Response } from 'express';
import { createNote, getNotes, getNoteById, updateNote, deleteNote } from './services';

// Handler for creating a new note
export async function createNoteHandler(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id; // Retrieved from authentication middleware
    const { title, content } = req.body;

    if (!title || !content) {
      res.status(400).json({ error: 'Title and content are required.' });
      return;
    }

    const note = await createNote(userId, title, content);
    res.status(201).json(note);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create note.' });
  }
}

// Handler for fetching all notes for the authenticated user
export async function getNotesHandler(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    const notes = await getNotes(userId);
    res.status(200).json(notes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch notes.' });
  }
}

// Handler for fetching a specific note by ID
export async function getNoteByIdHandler(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    const noteId = parseInt(req.params.id, 10);

    if (isNaN(noteId)) {
      res.status(400).json({ error: 'Invalid note ID.' });
      return;
    }

    const note = await getNoteById(userId, noteId);

    if (!note) {
      res.status(404).json({ error: 'Note not found.' });
      return;
    }

    res.status(200).json(note);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch note.' });
  }
}

// Handler for updating a specific note by ID
export async function updateNoteHandler(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    const noteId = parseInt(req.params.id, 10);
    const { title, content } = req.body;

    if (isNaN(noteId)) {
      res.status(400).json({ error: 'Invalid note ID.' });
      return;
    }

    if (!title && !content) {
      res.status(400).json({ error: 'Title or content must be provided for update.' });
      return;
    }

    const updatedNote = await updateNote(userId, noteId, { title, content });

    if (!updatedNote) {
      res.status(404).json({ error: 'Note not found or not authorized to update.' });
      return;
    }

    res.status(200).json(updatedNote);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update note.' });
  }
}

// Handler for deleting a specific note by ID
export async function deleteNoteHandler(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    const noteId = parseInt(req.params.id, 10);

    if (isNaN(noteId)) {
      res.status(400).json({ error: 'Invalid note ID.' });
      return;
    }

    const deleted = await deleteNote(userId, noteId);

    if (!deleted) {
      res.status(404).json({ error: 'Note not found or not authorized to delete.' });
      return;
    }

    res.status(200).json({ message: 'Note deleted successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete note.' });
  }
}