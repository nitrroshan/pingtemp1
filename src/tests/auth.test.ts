import request from 'supertest';
import app from '../app'; // Assuming app is the Express app

describe('Authentication Module', () => {
    describe('POST /register', () => {
        it('should register a new user and return 201', async () => {
            const response = await request(app)
                .post('/auth/register')
                .send({
                    email: 'test@example.com',
                    name: 'Test User',
                    password: 'Password123',
                });

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('message', 'User registered successfully');
            expect(response.body).toHaveProperty('userId');
        });
    });

    describe('POST /login', () => {
        it('should log in an existing user and return a JWT token', async () => {
            const response = await request(app)
                .post('/auth/login')
                .send({
                    email: 'test@example.com',
                    password: 'Password123',
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('token');
        });

        it('should return 401 for invalid credentials', async () => {
            const response = await request(app)
                .post('/auth/login')
                .send({
                    email: 'wrong@example.com',
                    password: 'WrongPassword',
                });

            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('error', 'Invalid email or password');
        });
    });
});