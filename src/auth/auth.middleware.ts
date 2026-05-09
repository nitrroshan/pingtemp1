import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './auth.service';

/**
 * Middleware to validate JWT tokens for protected routes.
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        console.warn(`[AUTH] Missing access token for request to: ${req.originalUrl}`);
        return res.status(401).json({ message: 'Access token is missing' });
    }

    try {
        const payload = verifyToken(token);
        req.user = payload; // Assign payload to request object for downstream use
        next();
    } catch (error) {
        console.error(`[AUTH] Invalid or expired token for request to: ${req.originalUrl}`);
        return res.status(403).json({ message: 'Invalid or expired access token' });
    }
}