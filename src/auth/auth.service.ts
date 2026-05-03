import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from './user.model';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('Environment variable JWT_SECRET must be set');
}

const SALT_ROUNDS = 10;

/**
 * Hash a plain text password securely.
 */
export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a plain text password with a hashed password.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

/**
 * Generate a JWT token for a user.
 */
export function generateToken(user: User): string {
    return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
        expiresIn: '1h',
    });
}

/**
 * Validate a JWT token and return the decoded payload.
 */
export function verifyToken(token: string): any {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        throw new Error('Invalid or expired token');
    }
}