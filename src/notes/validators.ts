import { body, param } from 'express-validator';

// Validation for creating a new note
export const validateCreateNote = [
    body('title').notEmpty().withMessage('Title is required'),
    body('content').notEmpty().withMessage('Content is required'),
];

// Validation for updating a note
export const validateUpdateNote = [
    param('id').isMongoId().withMessage('Invalid note ID'),
    body('title').optional().notEmpty().withMessage('Title cannot be empty'),
    body('content').optional().notEmpty().withMessage('Content cannot be empty'),
];

// Validation for deleting a note
export const validateDeleteNote = [
    param('id').isMongoId().withMessage('Invalid note ID'),
];