const path = require('path');
const express = require('express');
const logging = require(path.join(__dirname, '..', 'loggingMiddleware'));
const crypto = require('node:crypto');
const assert = require('node:assert');

const app = express();
app.use(express.json());
app.use(logging({ includeHeaders: true, includeBody: true }));
app.get('/health', (req, res) => {
	res.status(200).json({ status: 'ok' });
});
const codeToLink = new Map();
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

async function forwardPost(url, body, headers = {}) {
	assert(url, 'url required');
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body || {})
	});
	const text = await res.text();
	let json;
	try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
	return { status: res.status, ok: res.ok, json };
}

// Create Short URL
// Body: { url: string, validityMinutes?: number, shortcode?: string }
app.post('/shorten', (req, res) => {
	const { url, validityMinutes, shortcode } = req.body || {};
	// Validate url
	if (!url || typeof url !== 'string' || !isValidUrl(url)) {
		return res.status(400).json({ error: 'invalid url' });
	}
	// Validating validity here 
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
		// auto-generate unique code   we can use the liy 
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

// Registration proxy (one-time per instructions)
app.post('/register', async (req, res) => {
	try {
		const { email, name, mobileNo, githubUsername, rollNo, accessCode } = req.body || {};
		if (!email || !name || !rollNo || !accessCode) {
			return res.status(400).json({ error: 'missing required fields' });
		}
		const target = 'http://20.244.56.144/evaluation-service/register';
		const result = await forwardPost(target, { email, name, mobileNo, githubUsername, rollNo, accessCode });
		return res.status(result.status).json(result.json);
	} catch (err) {
		return res.status(500).json({ error: 'registration failed' });
	}
});

// Auth proxy – returns access_token
app.post('/auth', async (req, res) => {
	try {
		const { email, name, rollNo, accessCode, clientID, clientSecret } = req.body || {};
		if (!email || !name || !rollNo || !accessCode || !clientID || !clientSecret) {
			return res.status(400).json({ error: 'missing required fields' });
		}
		const target = 'http://20.244.56.144/evaluation-service/auth';
		const result = await forwardPost(target, { email, name, rollNo, accessCode, clientID, clientSecret });
		return res.status(result.status).json(result.json);
	} catch (err) {
		return res.status(500).json({ error: 'auth failed' });
	}
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server listening on http://localhost:${PORT}`);
});