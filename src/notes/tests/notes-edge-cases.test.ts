import request from 'supertest';
import app from '../app';

describe('Notes Endpoints Edge Cases', () => {
    test('POST /notes - Missing token', async () => {
        const res = await request(app)
            .post('/notes')
            .send({ title: 'Test Note', content: 'This is a test note.' });

        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Access token is missing');
    });

    test('POST /notes - Invalid token', async () => {
        const res = await request(app)
            .post('/notes')
            .set('Authorization', 'Bearer invalidtoken')
            .send({ title: 'Test Note', content: 'This is a test note.' });

        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Invalid or expired access token');
    });

    test('GET /notes - Missing token', async () => {
        const res = await request(app).get('/notes');
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Access token is missing');
    });

    test('GET /notes - Invalid token', async () => {
        const res = await request(app)
            .get('/notes')
            .set('Authorization', 'Bearer invalidtoken');

        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Invalid or expired access token');
    });

    test('PUT /notes/:id - Missing token', async () => {
        const res = await request(app)
            .put('/notes/1')
            .send({ title: 'Updated Note', content: 'Updated content.' });
        
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Access token is missing');
    });

    test('PUT /notes/:id - Invalid token', async () => {
        const res = await request(app)
            .put('/notes/1')
            .set('Authorization', 'Bearer invalidtoken')
            .send({ title: 'Updated Note', content: 'Updated content.' });
        
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Invalid or expired access token');
    });

    test('DELETE /notes/:id - Missing token', async () => {
        const res = await request(app).delete('/notes/1');
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Access token is missing');
    });

    test('DELETE /notes/:id - Invalid token', async () => {
        const res = await request(app)
            .delete('/notes/1')
            .set('Authorization', 'Bearer invalidtoken');

        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Invalid or expired access token');
    });
});