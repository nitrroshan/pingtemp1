import express from 'express';
import { NotesService } from '../services/notes.service';
import { Pool } from 'pg';
import { body, param, query, validationResult } from 'express-validator';

const router = express.Router();
const pool = new Pool(); // Normally, you'd configure this properly
const notesService = new NotesService(pool);

// Middleware for catching validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Create a note
router.post(
  '/',
  [
    body('title').isString().notEmpty().withMessage('Title is required'),
    body('content').isString().notEmpty().withMessage('Content is required'),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id; // Assuming req.user is populated via auth middleware
      const { title, content } = req.body;
      const note = await notesService.createNote(userId, title, content);
      res.status(201).json(note);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Get all notes
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id; // Assuming req.user is populated via auth middleware
    const notes = await notesService.getNotesByUser(userId);
    res.status(200).json(notes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get a single note
router.get(
  '/:id',
  [param('id').isUUID().withMessage('Invalid note ID')],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id; // Assuming req.user is populated via auth middleware
      const noteId = req.params.id;
      const note = await notesService.getNoteById(userId, noteId);
      if (!note) {
        return res.status(404).json({ message: 'Note not found' });
      }
      res.status(200).json(note);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Update a note
router.put(
  '/:id',
  [
    param('id').isUUID().withMessage('Invalid note ID'),
    body('title').isString().optional(),
    body('content').isString().optional(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id; // Assuming req.user is populated via auth middleware
      const noteId = req.params.id;
      const { title, content } = req.body;
      const note = await notesService.updateNote(userId, noteId, title, content);
      if (!note) {
        return res.status(404).json({ message: 'Note not found' });
      }
      res.status(200).json(note);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Delete a note
router.delete(
  '/:id',
  [param('id').isUUID().withMessage('Invalid note ID')],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id; // Assuming req.user is populated via auth middleware
      const noteId = req.params.id;
      const success = await notesService.deleteNote(userId, noteId);
      if (!success) {
        return res.status(404).json({ message: 'Note not found' });
      }
      res.status(204).send();
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Search notes
router.get(
  '/search',
  [query('q').isString().notEmpty().withMessage('Search term is required')],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id; // Assuming req.user is populated via auth middleware
      const searchTerm = req.query.q;
      const notes = await notesService.searchNotes(userId, searchTerm);
      res.status(200).json(notes);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

export default router;