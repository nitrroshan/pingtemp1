import express from 'express';
import { 
    createNoteHandler, 
    getNotesHandler, 
    updateNoteHandler, 
    deleteNoteHandler
} from './handlers';
import { authenticateJWT } from '../auth/auth.middleware';

const router = express.Router();

// Create a new note
router.post('/', authenticateJWT, createNoteHandler);

// Get notes for the authenticated user
router.get('/', authenticateJWT, getNotesHandler);

// Update a note by ID
router.put('/:id', authenticateJWT, updateNoteHandler);

// Delete a note by ID
router.delete('/:id', authenticateJWT, deleteNoteHandler);

export default router;