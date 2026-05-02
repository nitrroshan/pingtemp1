import { Request, Response } from 'express';
import { NoteModel } from './note.model';

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
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({ message: 'Search query is required' });
        }

        const notes = await NoteModel.find({
            user: userId,
            $text: { $search: query },
        });

        return res.status(200).json(notes);
    } catch (error) {
        return res.status(500).json({ message: 'Failed to search notes' });
    }
}