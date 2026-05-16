import request from 'supertest';
import app from '../app';
import { User } from './user.model';
import * as authService from './auth.service';

jest.mock('./user.model');
jest.mock('./auth.service');

describe('Authentication Module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /auth/login', () => {
        it('should return 400 if email or password is missing', async () => {
            const res = await request(app).post('/auth/login').send({});
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Email and password are required');
        });

        it('should return 401 if user does not exist', async () => {
            (User.findOne as jest.Mock).mockResolvedValue(null);
            const res = await request(app).post('/auth/login').send({ email: 'test@example.com', password: 'password' });
            expect(res.status).toBe(401);
            expect(res.body.error).toBe('Invalid email or password');
        });

        it('should return 401 if password is incorrect', async () => {
            (User.findOne as jest.Mock).mockResolvedValue({ id: 1, email: 'test@example.com', passwordHash: 'hashedpassword' });
            (authService.verifyPassword as jest.Mock).mockResolvedValue(false);

            const res = await request(app).post('/auth/login').send({ email: 'test@example.com', password: 'wrongpassword' });
            expect(res.status).toBe(401);
            expect(res.body.error).toBe('Invalid email or password');
        });

        it('should return 200 and a token if login is successful', async () => {
            (User.findOne as jest.Mock).mockResolvedValue({ id: 1, email: 'test@example.com', passwordHash: 'hashedpassword' });
            (authService.verifyPassword as jest.Mock).mockResolvedValue(true);
            (authService.generateToken as jest.Mock).mockReturnValue('jwt-token');

            const res = await request(app).post('/auth/login').send({ email: 'test@example.com', password: 'password' });
            expect(res.status).toBe(200);
            expect(res.body.token).toBe('jwt-token');
        });
    });
});