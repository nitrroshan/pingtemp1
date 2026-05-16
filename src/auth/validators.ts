import { body } from 'express-validator';

// Validation chain for user login
export const loginValidator = [
    body('email')
        .isEmail()
        .withMessage('Must be a valid email'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long')
];