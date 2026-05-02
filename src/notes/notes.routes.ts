import { Router } from 'express';
import { createNote, getUserNotes, searchNotes } from './notes.controller';
import { authenticate } from '../auth/auth.middleware';

const router = Router();

// Create a new note
router.post('/', authenticate, createNote);

// Get all notes for the authenticated user
router.get('/', authenticate, getUserNotes);

// Search notes by title or content for the authenticated user
router.get('/search', authenticate, searchNotes);

export default router;