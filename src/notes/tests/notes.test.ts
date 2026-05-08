import request from 'supertest';
import app from '../app';
import { db } from '../db';

// Tests for notes CRUD operations
describe('Notes CRUD Endpoints', () => {
  let token: string;
  let noteId: number;

  beforeAll(async () => {
    // Create a test user and log in to retrieve token
    await db.query("INSERT INTO users (email, password) VALUES ('testuser@example.com', '$2b$10$hashedpassword')");
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'testuser@example.com', password: 'password' });
    token = res.body.token;
  });

  afterAll(async () => {
    // Clean up test data
    await db.query('DELETE FROM notes');
    await db.query('DELETE FROM users');
  });

  test('Create a new note', async () => {
    const res = await request(app)
      .post('/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test Note', content: 'This is a test note.' });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('id');
    noteId = res.body.id;
  });

  test('Get all notes', async () => {
    const res = await request(app)
      .get('/notes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('Get a note by ID', async () => {
    const res = await request(app)
      .get(`/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(noteId);
  });

  test('Update a note', async () => {
    const res = await request(app)
      .put(`/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated Note', content: 'Updated content.' });

    expect(res.statusCode).toBe(200);
    expect(res.body.title).toBe('Updated Note');
  });

  test('Delete a note', async () => {
    const res = await request(app)
      .delete(`/notes/${noteId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Note deleted successfully.');
  });
});