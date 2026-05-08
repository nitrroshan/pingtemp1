import { Request, Response } from 'express';
import { NoteModel } from './note.model';
import { updateNoteService, deleteNoteService } from './notes.service';

/**
 * Create a new note.
 */
export async function createNote(req: Request, res: Response): Promise<Response> {
    try {
        const { title, content } = req.body;
        const userId = req.user.id; // Assuming user is authenticated and user ID is available

        if (!title || !content) {
            return res.status(400).json({ message: 'Title and content are required' });
        }

        const newNote = await NoteModel.create({
            title,
            content,
            user: userId,
        });

        return res.status(201).json(newNote);
    } catch (error) {
        return res.status(500).json({ message: 'Failed to create note' });
    }
}

/**
 * Fetch notes for the authenticated user.
 */
export async function getUserNotes(req: Request, res: Response): Promise<Response> {
    try {
        const userId = req.user.id; // Assuming user is authenticated

        const notes = await NoteModel.find({ user: userId });

        return res.status(200).json(notes);
    } catch (error) {
        return res.status(500).json({ message: 'Failed to fetch notes' });
    }
}

/**
 * Search notes by title or content.
 */
export async function searchNotes(req: Request, res: Response): Promise<Response> {
    try {
        const userId = req.user.id; // Assuming user is authenticated
        const { query, page = 1, limit = 10 } = req.query;

        if (!query || typeof query !== 'string') {
            return res.status(400).json({ message: 'Search query is required and must be a string' });
        }

        const skip = (Number(page) - 1) * Number(limit);

        const notes = await NoteModel.find({
            user: userId,
            $text: { $search: query },
        })
        .skip(skip)
        .limit(Number(limit));

        const total = await NoteModel.countDocuments({
            user: userId,
            $text: { $search: query },
        });

        return res.status(200).json({
            notes,
            total,
            page: Number(page),
            totalPages: Math.ceil(total / Number(limit))
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to search notes' });
    }
}

/**
 * Update an existing note.
 */
export async function updateNote(req: Request, res: Response): Promise<Response> {
    try {
        const { id } = req.params;
        const { title, content } = req.body;
        const userId = req.user.id;

        if (!title || !content) {
            return res.status(400).json({ message: 'Title and content are required' });
        }

        const updatedNote = await updateNoteService(userId, id, title, content);

        if (!updatedNote) {
            return res.status(404).json({ message: 'Note not found or not authorized' });
        }

        return res.status(200).json(updatedNote);
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to update note' });
    }
}

/**
 * Delete a note.
 */
export async function deleteNote(req: Request, res: Response): Promise<Response> {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const deletedNote = await deleteNoteService(userId, id);

        if (!deletedNote) {
            return res.status(404).json({ message: 'Note not found or not authorized' });
        }

        return res.status(200).json({ message: 'Note deleted successfully' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to delete note' });
    }
}