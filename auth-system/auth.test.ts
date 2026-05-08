import request from 'supertest';
import app from '../src/app'; // Assuming the Express app is exported from src/app.ts
import { db } from '../src/db';

describe('Authentication Endpoints', () => {
  beforeAll(async () => {
    await db.migrate.latest();
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('POST /register', () => {
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.statusCode).toEqual(201);
      expect(res.body.message).toBe('User registered successfully.');
    });

    it('should not register an existing user', async () => {
      await request(app)
        .post('/auth/register')
        .send({ email: 'duplicate@example.com', password: 'password123' });

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'duplicate@example.com', password: 'password123' });

      expect(res.statusCode).toEqual(409);
      expect(res.body.message).toBe('User already exists.');
    });
  });

  describe('POST /login', () => {
    it('should login a user with correct credentials', async () => {
      const email = 'test_login@example.com';
      const password = 'password123';

      await request(app)
        .post('/auth/register')
        .send({ email, password });

      const res = await request(app)
        .post('/auth/login')
        .send({ email, password });

      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('token');
    });

    it('should not login a user with incorrect credentials', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'wrong@example.com', password: 'wrongpassword' });

      expect(res.statusCode).toEqual(401);
      expect(res.body.message).toBe('Invalid credentials.');
    });
  });

  describe('POST /logout', () => {
    it('should logout a user', async () => {
      const email = 'test_logout@example.com';
      const password = 'password123';

      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email, password });

      expect(registerRes.statusCode).toEqual(201);

      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email, password });

      expect(loginRes.statusCode).toEqual(200);

      const token = loginRes.body.token;

      const logoutRes = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(logoutRes.statusCode).toEqual(200);
      expect(logoutRes.body.message).toBe('Logged out successfully.');
    });
  });
});