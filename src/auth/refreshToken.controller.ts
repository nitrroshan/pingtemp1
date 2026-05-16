import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;

const refreshTokens: string[] = []; // Temporary in-memory store for refresh tokens

if (!JWT_SECRET || !REFRESH_TOKEN_SECRET) {
    throw new Error('Environment variables JWT_SECRET and REFRESH_TOKEN_SECRET must be set');
}

/**
 * Generate a new access token using a refresh token.
 */
export async function refreshToken(req: Request, res: Response): Promise<Response> {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ message: 'Refresh token is required' });
    }

    if (!refreshTokens.includes(token)) {
        return res.status(403).json({ message: 'Invalid refresh token' });
    }

    try {
        const payload = jwt.verify(token, REFRESH_TOKEN_SECRET) as { id: string; email: string };
        const accessToken = jwt.sign({ id: payload.id, email: payload.email }, JWT_SECRET, {
            expiresIn: '1h',
        });

        return res.status(200).json({ accessToken });
    } catch (error) {
        return res.status(403).json({ message: 'Invalid or expired refresh token' });
    }
}

/**
 * Revoke a refresh token.
 */
export async function revokeRefreshToken(req: Request, res: Response): Promise<Response> {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ message: 'Refresh token is required' });
    }

    const tokenIndex = refreshTokens.indexOf(token);
    if (tokenIndex === -1) {
        return res.status(404).json({ message: 'Refresh token not found' });
    }

    refreshTokens.splice(tokenIndex, 1);
    return res.status(200).json({ message: 'Refresh token revoked successfully' });
}

/**
 * Issue a new refresh token.
 */
export function issueRefreshToken(user: { id: string; email: string }): string {
    const refreshToken = jwt.sign({ id: user.id, email: user.email }, REFRESH_TOKEN_SECRET, {
        expiresIn: '7d',
    });

    refreshTokens.push(refreshToken);
    return refreshToken;
}