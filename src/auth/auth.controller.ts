import { Request, Response } from 'express';
import { hashPassword, verifyPassword, generateToken } from './auth.service';
import { UserModel } from './user.model';

/**
 * User registration endpoint handler.
 */
export async function registerUser(req: Request, res: Response): Promise<Response> {
    try {
        const { email, password } = req.body;

        // Input validation
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        // Check if user already exists
        const existingUser = await UserModel.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email is already registered' });
        }

        // Hash password and create user
        const hashedPassword = await hashPassword(password);
        const newUser = await UserModel.create({ email, password: hashedPassword });

        return res.status(201).json({ message: 'User registered successfully', userId: newUser.id });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

/**
 * User login endpoint handler.
 */
export async function loginUser(req: Request, res: Response): Promise<Response> {
    try {
        const { email, password } = req.body;

        // Input validation
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        // Find user by email
        const user = await UserModel.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Verify password
        const isPasswordValid = await verifyPassword(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = generateToken(user);

        return res.status(200).json({ message: 'Login successful', token });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}