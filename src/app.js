const express = require('express');
const app = express();

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic test route
app.get('/', (req, res) => {
    res.json({ message: 'AI Agent Workflow Engine API' });
});

// Basic error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

module.exports = app; 