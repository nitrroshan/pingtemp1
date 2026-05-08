import request from 'supertest';
import app from '../app';

describe('Notes Endpoints', () => {
    let token: string;

    beforeAll(async () => {
        const res = await request(app).post('/auth/login').send({
            email: 'test@example.com',
            password: 'password123'
        });
        token = res.body.token;
    });

    test('POST /notes - Create a new note', async () => {
        const res = await request(app)
            .post('/notes')
            .set('Authorization', `Bearer ${token}`)
            .send({ title: 'Test Note', content: 'This is a test note.' });

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('id');
    });

    test('GET /notes - Fetch all notes for user', async () => {
        const res = await request(app)
            .get('/notes')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('PUT /notes/:id - Update a note', async () => {
        const res = await request(app)
            .put('/notes/1')
            .set('Authorization', `Bearer ${token}`)
            .send({ title: 'Updated Note', content: 'Updated content.' });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Updated Note');
    });

    test('DELETE /notes/:id - Delete a note', async () => {
        const res = await request(app)
            .delete('/notes/1')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Note deleted successfully');
    });
});