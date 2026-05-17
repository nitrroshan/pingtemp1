import { Router } from 'express';
import { register, login, logout } from './auth.controller';

const router = Router();

// User registration
router.post('/register', register);

// User login
router.post('/login', login);

// User logout
router.post('/logout', logout);

export default router;