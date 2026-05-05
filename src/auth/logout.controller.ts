import { Request, Response } from 'express';
import { deleteCache } from './cache.service';

/**
 * User logout endpoint handler.
 */
export async function logoutUser(req: Request, res: Response): Promise<Response> {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(400).json({ message: 'No token provided' });
        }

        // Invalidate token (for example, by using a blacklist or cache)
        await deleteCache(`blacklisted_token:${token}`);

        return res.status(200).json({ message: 'Logout successful' });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}