import express from 'express';
import { loginHandler, logoutHandler } from './auth.controller';
import { authenticateJWT } from './auth.middleware';

const router = express.Router();

// Public route for user login
router.post('/login', loginHandler);

// Route to log out (optional: invalidate refresh token if implemented)
router.post('/logout', authenticateJWT, logoutHandler);

export default router;