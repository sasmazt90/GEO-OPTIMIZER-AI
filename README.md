# GEO OPTIMIZER AI

Production-oriented GEO and LLMO platform with authenticated user accounts, AI analysis tools, crawler simulation, benchmark tables, and saved run history.

## Features

- Email/password account registration and login
- HttpOnly JWT session cookies
- Protected AI and crawler API routes
- Rate limiting, security headers, request validation, and saved run history
- OpenAI first, OpenRouter fallback
- Tools: AI Brand Entity, AI Search Crawler Simulation, Query Fan Out Analysis, AI Prompt Research, GEO Landing Page Creator, GEO Content Creator, GEO Content Check, Benchmark

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Environment

Copy `.env.example` to `.env` and fill in:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-4o-mini
JWT_SECRET=change-this-to-a-long-random-production-secret
PORT=8787
APP_URL=http://localhost:5173
```

## Production Run

```bash
npm install
npm run build
$env:NODE_ENV="production"; node server.js
```

The Express server serves the built frontend from `dist` and exposes `/api/*`.

## Notes

- Local user/run data is stored in `data/db.json`, which is gitignored.
- For a larger production deployment, replace the JSON file store with PostgreSQL or another managed database.
- Keep `.env` out of git. It is already gitignored.
