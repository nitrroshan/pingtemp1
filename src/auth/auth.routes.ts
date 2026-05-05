import { Router } from 'express';
import { registerUser, loginUser } from './auth.controller';

const router = Router();

// Register user endpoint
router.post('/register', registerUser);

// Login user endpoint
router.post('/login', loginUser);

// Logout user endpoint
import { logoutUser } from './logout.controller';
router.post('/logout', logoutUser);

export default router;