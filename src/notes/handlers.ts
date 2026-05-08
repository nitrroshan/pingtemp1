import { Request, Response } from 'express';
import {
    createNoteService,
    getUserNotesService,
    updateNoteService,
    deleteNoteService
} from './notes.service';

// Handler to create a new note
export async function createNoteHandler(req: Request, res: Response) {
    try {
        const userId = req.user.id;
        const { title, content } = req.body;
        const note = await createNoteService(userId, title, content);
        return res.status(201).json(note);
    } catch (error) {
        return res.status(500).json({ message: 'Failed to create note' });
    }
}

// Handler to get notes for a user
export async function getNotesHandler(req: Request, res: Response) {
    try {
        const userId = req.user.id;
        const notes = await getUserNotesService(userId);
        return res.status(200).json(notes);
    } catch (error) {
        return res.status(500).json({ message: 'Failed to fetch notes' });
    }
}

// Handler to update a note
export async function updateNoteHandler(req: Request, res: Response) {
    try {
        const userId = req.user.id;
        const noteId = req.params.id;
        const { title, content } = req.body;
        const updatedNote = await updateNoteService(userId, noteId, title, content);
        if (!updatedNote) {
            return res.status(404).json({ message: 'Note not found' });
        }
        return res.status(200).json(updatedNote);
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update note' });
    }
}

// Handler to delete a note
export async function deleteNoteHandler(req: Request, res: Response) {
    try {
        const userId = req.user.id;
        const noteId = req.params.id;
        const deletedNote = await deleteNoteService(userId, noteId);
        if (!deletedNote) {
            return res.status(404).json({ message: 'Note not found' });
        }
        return res.status(200).json({ message: 'Note deleted successfully' });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to delete note' });
    }
}