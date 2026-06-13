import request from 'supertest';
import app from '../../app';

describe('Notes Validation Tests', () => {
    test('Should return validation error for missing title in create note', async () => {
        const response = await request(app)
            .post('/notes')
            .send({ content: 'Sample content' })
            .expect(400);

        expect(response.body.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ msg: 'Title is required' })
            ])
        );
    });

    test('Should return validation error for invalid ID in update note', async () => {
        const response = await request(app)
            .put('/notes/invalid-id')
            .send({ title: 'Updated Title' })
            .expect(400);

        expect(response.body.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ msg: 'Invalid note ID' })
            ])
        );
    });

    test('Should return validation error for invalid ID in delete note', async () => {
        const response = await request(app)
            .delete('/notes/invalid-id')
            .expect(400);

        expect(response.body.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ msg: 'Invalid note ID' })
            ])
        );
    });
});