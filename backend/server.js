const path = require('path');
const express = require('express');
const logging = require(path.join(__dirname, '..', 'loggingMiddleware'));
const crypto = require('node:crypto');

const app = express();

// Middleware
app.use(express.json());
app.use(logging({ includeHeaders: true, includeBody: true }));
app.get('/health', (req, res) => {
	res.status(200).json({ status: 'ok' });
});
const codeToLink = new Map();

// Helpers
function isValidUrl(value) {
	try { new URL(value); return true; } catch (_) { return false; }
}

function generateCode(len = 6) {
	return crypto.randomBytes(Math.ceil(len * 0.75)).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, len);
}

function now() { return new Date(); }

function minutesFromNow(mins) {
	const d = new Date();
	d.setMinutes(d.getMinutes() + mins);
	return d;
}

function buildShortUrl(req, code) {
	const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
	return `${base}/${code}`;
}

// Create Short URL
// Body: { url: string, validityMinutes?: number, shortcode?: string }
app.post('/shorten', (req, res) => {
	const { url, validityMinutes, shortcode } = req.body || {};
	// Validate url
	if (!url || typeof url !== 'string' || !isValidUrl(url)) {
		return res.status(400).json({ error: 'invalid url' });
	}
	// Validate validity
	let ttlMinutes = Number.isFinite(Number(validityMinutes)) ? Number(validityMinutes) : 30; // default 30
	if (ttlMinutes <= 0) return res.status(400).json({ error: 'invalid validity' });

	// Validate/choose shortcode
	const codePattern = /^[a-zA-Z0-9]{3,32}$/;
	let code = typeof shortcode === 'string' && shortcode.trim() ? shortcode.trim() : undefined;
	if (code !== undefined) {
		if (!codePattern.test(code)) {
			return res.status(400).json({ error: 'invalid shortcode' });
		}
		if (codeToLink.has(code)) {
			return res.status(409).json({ error: 'shortcode already exists' });
		}
	} else {
		// auto-generate unique code
		let attempts = 0;
		do {
			code = generateCode(7);
			attempts += 1;
			if (attempts > 10) return res.status(500).json({ error: 'could not generate shortcode' });
		} while (codeToLink.has(code));
	}

	const createdAt = now();
	const expiresAt = minutesFromNow(ttlMinutes);
	codeToLink.set(code, { longUrl: url, createdAt, expiresAt, hits: 0 });

	return res.status(201).json({
		shortcode: code,
		shortUrl: buildShortUrl(req, code),
		expiresAt: expiresAt.toISOString()
	});
});

// Retrieve Short URL status
app.get('/status/:code', (req, res) => {
	const { code } = req.params;
	const record = codeToLink.get(code);
	if (!record) return res.status(404).json({ error: 'not found' });
	const expired = record.expiresAt <= now();
	return res.json({
		shortcode: code,
		shortUrl: buildShortUrl(req, code),
		longUrl: record.longUrl,
		createdAt: record.createdAt.toISOString(),
		expiresAt: record.expiresAt.toISOString(),
		expired,
		accessCount: record.hits
	});
});

// Redirection
app.get('/:code', (req, res) => {
	const { code } = req.params;
	const record = codeToLink.get(code);
	if (!record) return res.status(404).json({ error: 'not found' });
	if (record.expiresAt <= now()) return res.status(410).json({ error: 'expired' });
	record.hits += 1;
	return res.redirect(302, record.longUrl);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server listening on http://localhost:${PORT}`);
});