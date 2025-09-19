

### Overview
Express-based microservice that creates short URLs, redirects traffic, and exposes status for a shortcode. All HTTP requests are logged through a reusable middleware that can post logs to a protected external Log API.

### Requirements
- Node.js 18+
- npm

### Setup
1) Install dependencies
```bash
cd backend
npm i
```

2) Configure environment variables (create `.env` in repo root or `backend/`)
```env
# Logging API (protected)
LOG_API_URL=http://20.244.56.144/evaluation-service/logs
LOG_API_TOKEN=
LOG_STACK=backend
LOG_PACKAGE=url-shortener
LOG_LEVEL=info
LOG_CLIENT_ID=

# Server
PORT=3000
BASE_URL=http://localhost:3000
```

3) Start the server
```bash
cd backend
npm start
# Server listening on http://localhost:3000
```

### API
- POST `/shorten` → create a short URL
  - Body: `{ url: string, validityMinutes?: number (default 30), shortcode?: string }`
  - Response: `{ shortcode, shortUrl, expiresAt }`

- GET `/status/:code` → get metadata for a shortcode
  - Response: `{ shortcode, shortUrl, longUrl, createdAt, expiresAt, expired, accessCount }`

- GET `/:code` → redirect to the original `url` if not expired

- POST `/register` → proxy to `evaluation-service/register`
- POST `/auth` → proxy to `evaluation-service/auth`

### Examples
Create a short link:
```bash
curl -s -X POST http://localhost:3000/shorten \
  -H 'content-type: application/json' \
  -d '{ "url": "https://example.com", "validityMinutes": 10 }'
```

Follow and inspect:
```bash
curl -i http://localhost:3000/ABC123
curl -s http://localhost:3000/status/ABC123
```

### Logging Middleware
File: `loggingMiddleware.js`
- Express-compatible: `app.use(logging({ includeHeaders: true, includeBody: true }))`
- Sends logs to `LOG_API_URL` with `Authorization: Bearer LOG_API_TOKEN` when env is set; otherwise logs locally.
- Redacts sensitive headers/body keys and size-limits request bodies.
- Optional helper function:
```javascript
const { Log, generateJwt } = require('./loggingMiddleware');
await Log('backend','error','handler','received string, expected bool');

// Minimal HS256 token
const token = generateJwt({ sub: 'user-123' }, process.env.JWT_SECRET || 'dev-secret', { expiresInSeconds: 3600 });
```