/**
 * Simple HTTP request logging middleware for Express-compatible apps.
 *
 * Options:
 *  - logger(entryString)            default: console.log
 *  - format(entryObject)            default: auto format string
 *  - skip(entryObject, req, res)    default: no skip
 *
 * Usage:
 *   const logging = require('./loggingMiddleware');
 *   app.use(logging()); // defaults
 *   // or customize:
 *   app.use(logging({ logger: msg => myLogger.info(msg) }));
 */

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
		skipPaths = [] // strings or regex
	} = opts;

	return function (req, res, next) {
		const start = process.hrtime();
		const originalUrl = req.originalUrl || req.url;
		const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '-';

		// request id propagation
		let requestId = req.headers[requestIdHeader];
		if (!requestId) {
			requestId = generateId();
			try { res.setHeader(requestIdHeader, requestId); } catch (_) {}
		}
		// path skipping
		if (shouldSkipPath(originalUrl, skipPaths)) {
			return next();
		}

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

				if (includeHeaders) {
					entry.requestHeaders = redactObjectKeys(req.headers || {}, redactKeys);
				}
				if (includeBody) {
					entry.requestBody = limitSize(safeSerialize(req.body), maxBodyLength);
				}

				if (typeof skip === 'function' && skip(entry, req, res)) return;

				let message;
				if (typeof format === 'function') {
					message = format(entry);
				} else if (json) {
					message = JSON.stringify(entry);
				} else {
					message = `${entry.time} ${entry.method} ${entry.url} ${entry.status} ${entry.duration}ms - ${entry.ip}`;
				}

				logger(message);
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
	// simple, low-collision id for logging/tracing (not cryptographically secure)
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

module.exports = loggingMiddleware;
