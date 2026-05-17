import express from 'express';
import bodyParser from 'body-parser';
import authRoutes from './auth/auth.routes';

const app = express();

// Middleware
app.use(bodyParser.json());

// Authentication routes
app.use('/auth', authRoutes);

export default app;