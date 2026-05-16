import { Request, Response } from 'express';
import { User } from './user.model';
import { hashPassword, verifyPassword, generateToken } from './auth.service';

/**
 * Handle user login requests.
 */
export async function loginHandler(req: Request, res: Response): Promise<Response> {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        // Fetch user from database
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Verify password
        const isPasswordValid = await verifyPassword(password, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = generateToken(user);
        return res.status(200).json({ token });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * Handle user logout requests.
 */
export function logoutHandler(req: Request, res: Response): Response {
    // For JWT, logout can be handled by frontend simply deleting the token.
    // Optionally, maintain a token blacklist for advanced scenarios.
    return res.status(200).json({ message: 'Logged out successfully' });
}