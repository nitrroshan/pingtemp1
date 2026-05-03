import { Router } from 'express';
import { createNote, getUserNotes, searchNotes, updateNote, deleteNote } from './notes.controller';
import { rateLimit } from '../middleware/rateLimit.middleware';
import { authenticate } from '../auth/auth.middleware';

const router = Router();

// Create a new note
router.post('/', authenticate, rateLimit, createNote);

// Get all notes for the authenticated user
router.get('/', authenticate, rateLimit, getUserNotes);

// Search notes by title or content for the authenticated user
router.get('/search', authenticate, rateLimit, searchNotes);

// Update an existing note
router.put('/:id', authenticate, rateLimit, updateNote);

// Delete a note
router.delete('/:id', authenticate, rateLimit, deleteNote);

export default router;