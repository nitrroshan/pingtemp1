import request from 'supertest';
import express from 'express';
import searchRoutes from './search';

const app = express();
app.use(express.json());
app.use('/api', searchRoutes);

describe('GET /api/search', () => {
    it('should return 400 if query parameter is missing', async () => {
        const response = await request(app).get('/api/search');
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Query parameter is required and must be a string.');
    });

    it('should return 400 if page or limit is invalid', async () => {
        const response = await request(app).get('/api/search').query({ query: 'test', page: '0', limit: '-1' });
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Page and limit must be positive integers.');
    });

    it('should return search results with pagination', async () => {
        // Mocking the pool query for testing
        jest.mock('../db', () => ({
            pool: {
                query: jest.fn().mockResolvedValue({
                    rows: [
                        { id: 1, title: 'Test Note', content: 'This is a test.', user_id: 1, created_at: new Date(), updated_at: new Date() },
                    ],
                }),
            },
        }));

        const response = await request(app).get('/api/search').query({ query: 'test', page: '1', limit: '10' });
        expect(response.status).toBe(200);
        expect(response.body.data.length).toBeGreaterThan(0);
        expect(response.body.pagination.page).toBe(1);
        expect(response.body.pagination.limit).toBe(10);
    });
});