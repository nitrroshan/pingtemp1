import { Router } from 'express';
import { registerUser, loginUser } from './auth.controller';

const router = Router();

// Register user endpoint
router.post('/register', registerUser);

// Login user endpoint
router.post('/login', loginUser);

export default router;