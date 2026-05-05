import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from './user.model';
import { getCache, setCache } from './cache.service';

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 7; // 7 days

if (!REFRESH_TOKEN_SECRET) {
    throw new Error('Environment variable REFRESH_TOKEN_SECRET must be set');
}

/**
 * Refresh the access token using a valid refresh token.
 */
export async function refreshToken(req: Request, res: Response): Promise<Response> {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({ message: 'Refresh token is required' });
        }

        // Verify refresh token
        let payload;
        try {
            payload = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
        } catch {
            return res.status(401).json({ message: 'Invalid or expired refresh token' });
        }

        // Check if refresh token is blacklisted
        const isBlacklisted = await getCache(`blacklisted_refresh_token:${refreshToken}`);
        if (isBlacklisted) {
            return res.status(403).json({ message: 'Token has been revoked' });
        }

        // Generate new access token
        const user = await UserModel.findById(payload.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const newAccessToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        return res.status(200).json({ token: newAccessToken });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}