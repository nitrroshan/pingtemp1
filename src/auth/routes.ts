import express from 'express';
import { hashPassword, comparePassword, generateToken } from './auth';
import { pool } from '../db'; // Assuming a db pool is available

const router = express.Router();

// Register Endpoint
router.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rowCount > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash the password and insert the user
    const hashedPassword = await hashPassword(password);
    await pool.query('INSERT INTO users (email, hashed_password) VALUES ($1, $2)', [email, hashedPassword]);

    return res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Login Endpoint
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Fetch the user from the database
    const user = await pool.query('SELECT id, hashed_password FROM users WHERE email = $1', [email]);
    if (user.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const { id, hashed_password } = user.rows[0];

    // Compare the password
    const isPasswordValid = await comparePassword(password, hashed_password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Generate a token
    const token = generateToken({ userId: id });

    return res.status(200).json({ token });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;