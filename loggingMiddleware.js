
function loggingMiddleware(opts = {}) {
	const {
		logger = console.log,
		format,
		skip,
		json = false,
		includeHeaders = false,
		includeBody = false,
		redactKeys = ['authorization', 'cookie', 'set-cookie', 'clientsecret', 'password', 'access_token', 'refresh_token'],
		maxBodyLength = 2048,
		requestIdHeader = 'x-request-id',
		generateId = defaultIdGenerator,
		skipPaths = [],
		// Remote logging API
		remoteLogUrl = process.env.LOG_API_URL || opts.remoteLogUrl,
		authToken = process.env.LOG_API_TOKEN || opts.authToken,
		remoteStack = (process.env.LOG_STACK || opts.remoteStack || '').toLowerCase(),
		remotePackage = (process.env.LOG_PACKAGE || opts.remotePackage || '').toLowerCase(),
		defaultLevel = (process.env.LOG_LEVEL || opts.defaultLevel || 'info').toLowerCase(),
		logClientId = process.env.LOG_CLIENT_ID || opts.logClientId
	} = opts;

	return function (req, res, next) {
		const start = process.hrtime();
		const originalUrl = req.originalUrl || req.url;
		const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '-';
		let requestId = req.headers[requestIdHeader];
		if (!requestId) {
			requestId = generateId();
			try { res.setHeader(requestIdHeader, requestId); } catch (_) {}
		}
		if (shouldSkipPath(originalUrl, skipPaths)) return next();

		function onFinish() {
			try {
				const [s, ns] = process.hrtime(start);
				const durationMs = Number((s * 1e3 + ns / 1e6).toFixed(3));
				const contentLength = Number(res.getHeader && res.getHeader('content-length')) || undefined;
				const entry = {
					time: new Date().toISOString(),
					requestId,
					method: req.method,
					url: originalUrl,
					status: res.statusCode,
					duration: durationMs,
					ip,
					userAgent: req.headers['user-agent'] || '-',
					contentLength
				};

				if (includeHeaders) entry.requestHeaders = redactObjectKeys(req.headers || {}, redactKeys);
				if (includeBody) entry.requestBody = limitSize(safeSerialize(req.body), maxBodyLength);

				if (typeof skip === 'function' && skip(entry, req, res)) return;

				let message;
				if (typeof format === 'function') message = format(entry);
				else if (json) message = JSON.stringify(entry);
				else message = `${entry.time} ${entry.method} ${entry.url} ${entry.status} ${entry.duration}ms - ${entry.ip}`;

				if (remoteLogUrl && authToken && remoteStack && remotePackage) {
					const payload = {
						stack: remoteStack,
						level: defaultLevel,
						package: remotePackage,
						message,
						context: entry,
						logId: logClientId || undefined
					};
					postToRemote(remoteLogUrl, authToken, payload).catch(() => {});
				} else {
					logger(message);
				}
			} catch (err) {
				try { console.error('loggingMiddleware error:', err); } catch (_) {}
			} finally {
				res.removeListener('finish', onFinish);
				res.removeListener('close', onFinish);
			}
		}

		res.on('finish', onFinish);
		res.on('close', onFinish);
		next();
	};
}


async function sendLog(stack, level, pkg, message, extra = {}) {
	const url = process.env.LOG_API_URL;
	const token = process.env.LOG_API_TOKEN;
	if (!url || !token) return false;
	const payload = {
		stack: String(stack || '').toLowerCase(),
		level: String(level || 'info').toLowerCase(),
		package: String(pkg || ''),
		message: String(message || ''),
		...extra,
		logId: process.env.LOG_CLIENT_ID || extra.logId
	};
	try { await postToRemote(url, token, payload); return true; } catch (_) { return false; }
}

function redactObjectKeys(obj, keysToRedact) {
	const lowered = new Set((keysToRedact || []).map(k => String(k).toLowerCase()));
	const out = {};
	for (const k in obj) {
		const v = obj[k];
		out[k] = lowered.has(String(k).toLowerCase()) ? '[REDACTED]' : v;
	}
	return out;
}

function limitSize(value, max) {
	try {
		const str = typeof value === 'string' ? value : JSON.stringify(value);
		if (!str) return undefined;
		return str.length > max ? str.slice(0, max) + `...(${str.length - max} more bytes)` : str;
	} catch (_) {
		return undefined;
	}
}

function safeSerialize(value) {
	if (value === undefined) return undefined;
	try { return JSON.parse(JSON.stringify(value)); } catch (_) { return undefined; }
}

function shouldSkipPath(url, skipPaths) {
	if (!skipPaths || skipPaths.length === 0) return false;
	try {
		for (const p of skipPaths) {
			if (typeof p === 'string' && url.startsWith(p)) return true;
			if (p instanceof RegExp && p.test(url)) return true;
		}
	} catch (_) {}
	return false;
}

function defaultIdGenerator() {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function postToRemote(url, token, payload) {
	try {
		const body = JSON.stringify(payload);
		if (typeof fetch === 'function') {
			await fetch(url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'authorization': `Bearer ${token}`
				},
				body,
				keepalive: true
			});
			return;
		}
		const mod = url.startsWith('https') ? require('node:https') : require('node:http');
		const { URL } = require('node:url');
		const u = new URL(url);
		const req = mod.request({
			hostname: u.hostname,
			port: u.port || (u.protocol === 'https:' ? 443 : 80),
			path: u.pathname + (u.search || ''),
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'authorization': `Bearer ${token}`,
				'content-length': Buffer.byteLength(body)
			}
		}, res => { try { res.resume(); } catch (_) {} });
		req.on('error', () => {});
		req.end(body);
	} catch (_) {}
}

module.exports = loggingMiddleware;
module.exports.Log = sendLog;
module.exports.generateJwt = generateJwt;

// Minimal HS256 JWT creator (no external deps)
function generateJwt(claims = {}, secret = process.env.JWT_SECRET || 'dev-secret', { expiresInSeconds } = {}) {
	const header = { alg: 'HS256', typ: 'JWT' };
	const nowSec = Math.floor(Date.now() / 1000);
	const body = { iat: nowSec, ...claims };
	if (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
		body.exp = nowSec + Number(expiresInSeconds);
	}
	const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
	const data = `${enc(header)}.${enc(body)}`;
	const sig = require('node:crypto').createHmac('sha256', secret).update(data).digest('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
	return `${data}.${sig}`;
}


