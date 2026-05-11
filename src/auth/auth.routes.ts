import { Router } from 'express';
import { registerUser, loginUser } from './auth.controller';
import { refreshToken, revokeRefreshToken } from './refreshToken.controller';

const router = Router();

// Authentication routes
router.post('/auth/register', registerUser);
router.post('/auth/login', loginUser);
router.post('/auth/token/refresh', refreshToken);
router.post('/auth/token/revoke', revokeRefreshToken);

export default router;