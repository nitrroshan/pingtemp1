import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './auth.service';

/**
 * Middleware to validate JWT token and attach user to the request object.
 */
export function authenticateJWT(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;

    // Check if Authorization header is present
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized access' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const payload = verifyToken(token);
        (req as any).user = payload; // Attach user information to request object
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}