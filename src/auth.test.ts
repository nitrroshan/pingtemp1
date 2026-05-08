import request from 'supertest';
import express from 'express';
import authRouter from './auth';
import { Pool } from 'pg';

jest.mock('pg', () => {
    const mockClient = {
        query: jest.fn(),
        release: jest.fn()
    };
    const mockPool = {
        connect: jest.fn(() => mockClient)
    };
    return { Pool: jest.fn(() => mockPool) };
});

const app = express();
app.use(express.json());
app.use('/auth', authRouter);

describe('Auth API', () => {
    const mockPool = new Pool();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /auth/register', () => {
        it('should register a new user', async () => {
            const email = 'test@example.com';
            const password = 'password123';

            mockPool.connect.mockResolvedValueOnce({
                query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 1, email }] }),
                release: jest.fn()
            });

            const response = await request(app).post('/auth/register').send({ email, password });

            expect(response.status).toBe(201);
            expect(response.body).toEqual({ id: 1, email });
        });

        it('should return 409 if email already exists', async () => {
            const email = 'test@example.com';
            const password = 'password123';

            const mockError = new Error('Unique constraint violation');
            mockError.code = '23505';

            mockPool.connect.mockResolvedValueOnce({
                query: jest.fn().mockRejectedValueOnce(mockError),
                release: jest.fn()
            });

            const response = await request(app).post('/auth/register').send({ email, password });

            expect(response.status).toBe(409);
            expect(response.body).toEqual({ message: 'Email already exists.' });
        });
    });

    describe('POST /auth/login', () => {
        it('should login a user and return a token', async () => {
            const email = 'test@example.com';
            const password = 'password123';
            const hashedPassword = await bcrypt.hash(password, 10);
            const userId = 1;

            mockPool.connect.mockResolvedValueOnce({
                query: jest.fn().mockResolvedValueOnce({ rows: [{ id: userId, email, password: hashedPassword }] }),
                release: jest.fn()
            });

            const response = await request(app).post('/auth/login').send({ email, password });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('token');
        });

        it('should return 401 for invalid credentials', async () => {
            const email = 'test@example.com';
            const password = 'wrongpassword';
            const hashedPassword = await bcrypt.hash('password123', 10);

            mockPool.connect.mockResolvedValueOnce({
                query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 1, email, password: hashedPassword }] }),
                release: jest.fn()
            });

            const response = await request(app).post('/auth/login').send({ email, password });

            expect(response.status).toBe(401);
            expect(response.body).toEqual({ message: 'Invalid credentials.' });
        });
    });

    describe('POST /auth/refresh-token', () => {
        it('should refresh token', async () => {
            const token = jwt.sign({ userId: 1 }, 'your_jwt_secret', { expiresIn: '1h' });

            const response = await request(app).post('/auth/refresh-token').send({ token });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('token');
        });

        it('should return 401 for invalid token', async () => {
            const token = 'invalidtoken';

            const response = await request(app).post('/auth/refresh-token').send({ token });

            expect(response.status).toBe(401);
            expect(response.body).toEqual({ message: 'Invalid token.' });
        });
    });
});