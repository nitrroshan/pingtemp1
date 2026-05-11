import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from './user.model';

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;

if (!JWT_SECRET || !REFRESH_TOKEN_SECRET) {
    throw new Error('Environment variables JWT_SECRET and REFRESH_TOKEN_SECRET must be set');
}

const TOKEN_EXPIRATION = '1h';
const REFRESH_TOKEN_EXPIRATION = '7d';

// In-memory store for refresh tokens (can be replaced with a database)
const refreshTokens: Record<string, string> = {};

/**
 * Generate both access and refresh tokens
 */
function generateTokens(userId: string, email: string): { accessToken: string; refreshToken: string } {
    const accessToken = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
    const refreshToken = jwt.sign({ id: userId, email }, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRATION });

    refreshTokens[refreshToken] = userId; // Save refresh token
    return { accessToken, refreshToken };
}

/**
 * Refresh token endpoint handler
 */
export async function refreshToken(req: Request, res: Response): Promise<Response> {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token is required' });
        }

        // Verify refresh token
        const payload = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
        if (typeof payload !== 'object' || !refreshTokens[refreshToken]) {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }

        const userId = refreshTokens[refreshToken];
        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Generate new tokens
        const tokens = generateTokens(user.id, user.email);

        return res.status(200).json({ message: 'Token refreshed', ...tokens });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Revoke refresh token endpoint handler
 */
export async function revokeRefreshToken(req: Request, res: Response): Promise<Response> {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token is required' });
        }

        if (refreshTokens[refreshToken]) {
            delete refreshTokens[refreshToken];
            return res.status(200).json({ message: 'Refresh token revoked successfully' });
        }

        return res.status(404).json({ error: 'Refresh token not found' });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}

export { generateTokens };