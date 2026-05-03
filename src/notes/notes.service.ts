import { NoteModel } from './note.model';
import { Types } from 'mongoose';

/**
 * Create a new note.
 */
export async function createNoteService(userId: string, title: string, content: string) {
    return await NoteModel.create({
        user: userId,
        title,
        content
    });
}

/**
 * Get notes for a specific user.
 */
export async function getUserNotesService(userId: string) {
    return await NoteModel.find({ user: userId }).exec();
}

/**
 * Search notes by title or content for a specific user.
 */
export async function searchNotesService(userId: string, query: string) {
    return await NoteModel.find({
        user: userId,
        $text: { $search: query }
    }).exec();
}

/**
 * Update a note by its ID.
 */
export async function updateNoteService(userId: string, noteId: string, title: string, content: string) {
    if (!Types.ObjectId.isValid(noteId)) {
        throw new Error('Invalid note ID');
    }

    return await NoteModel.findOneAndUpdate(
        { _id: noteId, user: userId },
        { title, content, updatedAt: new Date() },
        { new: true }
    ).exec();
}

/**
 * Delete a note by its ID.
 */
export async function deleteNoteService(userId: string, noteId: string) {
    if (!Types.ObjectId.isValid(noteId)) {
        throw new Error('Invalid note ID');
    }

    return await NoteModel.findOneAndDelete({ _id: noteId, user: userId }).exec();
}