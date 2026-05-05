const express = require('express');
const dotenv = require('dotenv');
const authRoutes = require('./routes/auth');
const { authenticateToken } = require('./auth-middleware');

dotenv.config();
const app = express();

app.use(express.json());
app.use('/api/auth', authRoutes);

// Example of a protected route
app.get('/api/protected', authenticateToken, (req, res) => {
    res.status(200).json({ message: 'Access granted.', user: req.user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});