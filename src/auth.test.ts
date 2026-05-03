import request from 'supertest';
import app from './app'; // Assuming app is the Express application
import { pool } from './db';

describe('Authentication Endpoints', () => {
    beforeAll(async () => {
        // Clean up database before running tests
        await pool.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
    });

    afterAll(async () => {
        // Close database connection after tests
        await pool.end();
    });

    describe('POST /register', () => {
        it('should register a new user successfully', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    email: 'testuser@example.com',
                    password: 'securepassword',
                    name: 'Test User'
                });

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('message', 'User registered successfully.');
            expect(response.body).toHaveProperty('token');
        });

        it('should return 400 if required fields are missing', async () => {
            const response = await request(app)
                .post('/register')
                .send({
                    email: 'testuser@example.com'
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Email, password, and name are required.');
        });

        it('should return 409 if the user already exists', async () => {
            // Register a user first
            await request(app)
                .post('/register')
                .send({
                    email: 'duplicateuser@example.com',
                    password: 'securepassword',
                    name: 'Duplicate User'
                });

            // Attempt to register the same user again
            const response = await request(app)
                .post('/register')
                .send({
                    email: 'duplicateuser@example.com',
                    password: 'securepassword',
                    name: 'Duplicate User'
                });

            expect(response.status).toBe(409);
            expect(response.body).toHaveProperty('error', 'User with this email already exists.');
        });
    });

    describe('POST /login', () => {
        it('should log in a registered user successfully', async () => {
            // Register a user first
            await request(app)
                .post('/register')
                .send({
                    email: 'loginuser@example.com',
                    password: 'securepassword',
                    name: 'Login User'
                });

            // Login with the same user
            const response = await request(app)
                .post('/login')
                .send({
                    email: 'loginuser@example.com',
                    password: 'securepassword'
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('message', 'Login successful.');
            expect(response.body).toHaveProperty('token');
        });

        it('should return 400 if required fields are missing', async () => {
            const response = await request(app)
                .post('/login')
                .send({
                    email: 'loginuser@example.com'
                });

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Email and password are required.');
        });

        it('should return 401 if credentials are invalid', async () => {
            const response = await request(app)
                .post('/login')
                .send({
                    email: 'nonexistentuser@example.com',
                    password: 'wrongpassword'
                });

            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('error', 'Invalid email or password.');
        });
    });
});