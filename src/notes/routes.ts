import express from 'express';
import { requireAuth } from '../auth/middleware';
import { createNoteHandler, getNotesHandler, getNoteByIdHandler, updateNoteHandler, deleteNoteHandler } from './handlers';

const router = express.Router();

// Routes for notes
router.post('/', requireAuth, createNoteHandler); // Create a new note
router.get('/', requireAuth, getNotesHandler); // Get all notes for authenticated user
router.get('/:id', requireAuth, getNoteByIdHandler); // Get a specific note by ID
router.put('/:id', requireAuth, updateNoteHandler); // Update a specific note by ID
router.delete('/:id', requireAuth, deleteNoteHandler); // Delete a specific note by ID

export default router;