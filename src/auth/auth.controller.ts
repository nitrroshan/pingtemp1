import { Request, Response } from 'express';
import { hashPassword, verifyPassword, generateToken } from './auth.service';
import { User } from './user.model';

/**
 * Handle user registration.
 */
export async function register(req: Request, res: Response): Promise<void> {
    const { email, name, password } = req.body;

    if (!email || !name || !password) {
        res.status(400).json({ error: 'All fields are required: email, name, password' });
        return;
    }

    try {
        const hashedPassword = await hashPassword(password);
        const newUser = await User.create({ email, name, password: hashedPassword });
        res.status(201).json({ message: 'User registered successfully', userId: newUser.id });
    } catch (error) {
        res.status(500).json({ error: 'Failed to register user' });
    }
}

/**
 * Handle user login.
 */
export async function login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
    }

    try {
        const user = await User.findOne({ where: { email } });
        if (!user) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }

        const isPasswordValid = await verifyPassword(password, user.password);
        if (!isPasswordValid) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }

        const token = generateToken(user);
        res.status(200).json({ token });
    } catch (error) {
        res.status(500).json({ error: 'Failed to log in' });
    }
}

/**
 * Handle user logout.
 */
export function logout(req: Request, res: Response): void {
    // Token invalidation logic can go here if blacklisting is used.
    res.status(200).json({ message: 'User logged out successfully' });
}