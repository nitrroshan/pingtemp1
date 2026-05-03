import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { pool } from './db'; // Assuming a database connection file exists

// Constants
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';
const SALT_ROUNDS = 10;

// Helper function to hash passwords
async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
}

// Helper function to verify passwords
async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

// Helper function to generate JWT
type JwtPayload = { id: number; email: string };
function generateToken(payload: JwtPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

// Register endpoint
export async function register(req: Request, res: Response): Promise<void> {
    const { email, password, name } = req.body;

    // Input validation
    if (!email || !password || !name) {
        res.status(400).json({ error: 'Email, password, and name are required.' });
        return;
    }

    try {
        // Check if user already exists
        const existingUserQuery = 'SELECT id FROM users WHERE email = $1';
        const existingUserResult = await pool.query(existingUserQuery, [email]);

        if (existingUserResult.rowCount > 0) {
            res.status(409).json({ error: 'User with this email already exists.' });
            return;
        }

        // Hash password
        const passwordHash = await hashPassword(password);

        // Insert new user into the database
        const insertUserQuery = `
            INSERT INTO users (email, password_hash, name, created_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW())
            RETURNING id;
        `;
        const insertUserResult = await pool.query(insertUserQuery, [email, passwordHash, name]);

        const userId = insertUserResult.rows[0].id;

        // Generate JWT
        const token = generateToken({ id: userId, email });

        // Return response
        res.status(201).json({ message: 'User registered successfully.', token });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
}

// Login endpoint
export async function login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
    }

    try {
        // Check if user exists
        const userQuery = 'SELECT id, password_hash FROM users WHERE email = $1';
        const userResult = await pool.query(userQuery, [email]);

        if (userResult.rowCount === 0) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }

        const { id, password_hash: passwordHash } = userResult.rows[0];

        // Verify password
        const isPasswordValid = await verifyPassword(password, passwordHash);
        if (!isPasswordValid) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }

        // Generate JWT
        const token = generateToken({ id, email });

        // Return response
        res.status(200).json({ message: 'Login successful.', token });
    } catch (error) {
        console.error('Error logging in user:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
}