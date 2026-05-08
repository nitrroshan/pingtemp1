import express from 'express';
import { register, login, logout, authenticateToken } from './auth.controller';

const router = express.Router();

router.post('/register', register); // Endpoint for user registration
router.post('/login', login);       // Endpoint for user login
router.post('/logout', authenticateToken, logout); // Endpoint for user logout

export default router;