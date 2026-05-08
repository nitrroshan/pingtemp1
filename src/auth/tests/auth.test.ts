import request from 'supertest';
import app from '../../app'; // Assuming your Express app is exported from app.ts
import { pool } from '../../db';

describe('Authentication Endpoints', () => {
  beforeAll(async () => {
    // Setup test database (e.g., truncate users table)
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    // Cleanup database connections
    await pool.end();
  });

  describe('POST /auth/register', () => {
    it('should register a new user', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('message', 'User registered successfully');
    });

    it('should not allow duplicate registration', async () => {
      await request(app).post('/auth/register').send({ email: 'duplicate@example.com', password: 'password123' });

      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'duplicate@example.com', password: 'password123' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'User already exists');
    });
  });

  describe('POST /auth/login', () => {
    it('should login a registered user', async () => {
      await request(app).post('/auth/register').send({ email: 'login@example.com', password: 'password123' });

      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'login@example.com', password: 'password123' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
    });

    it('should not login with invalid credentials', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'invalid@example.com', password: 'wrongpassword' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid credentials');
    });
  });
});