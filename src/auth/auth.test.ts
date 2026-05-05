import request from 'supertest';
import app from '../app';
import { UserModel } from './user.model';

jest.mock('./user.model');

// Mock the environment variables
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';

describe('Authentication Endpoints', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /auth/register', () => {
        it('should register a user successfully', async () => {
            UserModel.findOne = jest.fn().mockResolvedValue(null);
            UserModel.create = jest.fn().mockResolvedValue({ id: '1', email: 'test@example.com' });

            const res = await request(app)
                .post('/auth/register')
                .send({ email: 'test@example.com', password: 'Password123!' });

            expect(res.status).toBe(201);
            expect(res.body.message).toBe('User registered successfully');
        });
    });

    describe('POST /auth/login', () => {
        it('should log in a user successfully', async () => {
            UserModel.findOne = jest.fn().mockResolvedValue({ id: '1', email: 'test@example.com', password: 'hashedpassword123' });
            const mockVerifyPassword = jest.fn().mockResolvedValue(true);

            jest.mock('./auth.service', () => ({
                ...jest.requireActual('./auth.service'),
                verifyPassword: mockVerifyPassword,
                generateToken: jest.fn(() => 'mock-jwt-token'),
            }));

            const res = await request(app)
                .post('/auth/login')
                .send({ email: 'test@example.com', password: 'Password123!' });

            expect(res.status).toBe(200);
            expect(res.body.token).toBe('mock-jwt-token');
        });
    });

    describe('POST /auth/logout', () => {
        it('should log out a user successfully', async () => {
            const res = await request(app)
                .post('/auth/logout')
                .set('Authorization', 'Bearer mock-jwt-token');

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Logout successful');
        });
    });

    describe('POST /auth/refresh-token', () => {
        it('should refresh an access token successfully', async () => {
            const mockVerify = jest.fn().mockReturnValue({ id: '1' });
            jest.mock('jsonwebtoken', () => ({
                ...jest.requireActual('jsonwebtoken'),
                verify: mockVerify,
                sign: jest.fn(() => 'new-jwt-token'),
            }));

            const res = await request(app)
                .post('/auth/refresh-token')
                .send({ refreshToken: 'mock-refresh-token' });

            expect(res.status).toBe(200);
            expect(res.body.token).toBe('new-jwt-token');
        });
    });
});