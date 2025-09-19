const path = require('path');
const express = require('express');
const logging = require(path.join(__dirname, '..', 'loggingMiddleware'));

const app = express();

// Middleware
app.use(express.json());
app.use(logging());

// Healthcheck
app.get('/health', (req, res) => {
	res.status(200).json({ status: 'ok' });
});

// Routes
app.post('/data', (req, res) => {
	res.json({ message: 'Data received', body: req.body || null });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server listening on http://localhost:${PORT}`);
});