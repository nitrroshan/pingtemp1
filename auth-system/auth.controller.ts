import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const JWT_EXPIRATION = '1h';

/**
 * Registration Controller
 */
export const register = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const existingUser = await db('users').where({ email }).first();
    if (existingUser) {
      return res.status(409).json({ message: 'User already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db('users').insert({ email, password_hash: hashedPassword });

    return res.status(201).json({ message: 'User registered successfully.' });
  } catch (error) {
    console.error('Error during registration:', error);
    return res.status(500).json({ message: 'An error occurred. Please try again later.' });
  }
};

/**
 * Login Controller
 */
export const login = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await db('users').where({ email }).first();
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRATION });

    return res.status(200).json({ token });
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ message: 'An error occurred. Please try again later.' });
  }
};

/**
 * Logout Controller
 */
export const logout = async (req: Request, res: Response): Promise<Response> => {
  try {
    // Example: Token blacklist can be implemented here if needed
    return res.status(200).json({ message: 'Logged out successfully.' });
  } catch (error) {
    console.error('Error during logout:', error);
    return res.status(500).json({ message: 'An error occurred. Please try again later.' });
  }
};

/**
 * Middleware to Validate JWT
 */
export const authenticateToken = (req: Request, res: Response, next: Function): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token is missing.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
};