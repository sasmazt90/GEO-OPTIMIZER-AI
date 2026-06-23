# GEO OPTIMIZER AI

Production-oriented GEO and LLMO platform with authenticated user accounts, AI analysis tools, crawler simulation, benchmark tables, and saved run history.

## Features

- Email/password account registration and login
- HttpOnly JWT session cookies
- Protected AI and crawler API routes
- Rate limiting, security headers, request validation, and saved run history
- OpenAI first, OpenRouter fallback
- OpenRouter-first AI model calls
- Supabase persistence adapter with local JSON fallback
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
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
JWT_SECRET=change-this-to-a-long-random-production-secret
PORT=8787
APP_URL=http://localhost:5173
```

## Supabase

Apply the migration in `supabase/migrations/20260623000100_geo_optimizer_ai.sql` to create:

- `public.geo_app_users`
- `public.geo_app_runs`

The migration includes explicit `GRANT` statements for `service_role` and enables RLS. The app only uses the Supabase secret key on the backend.

## Production Run

```bash
npm install
npm run build
$env:NODE_ENV="production"; node server.js
```

The Express server serves the built frontend from `dist` and exposes `/api/*`.

## Notes

- Local user/run data is stored in `data/db.json`, which is gitignored.
- Supabase is used when `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are configured and the migration has been applied.
- Local user/run data falls back to `data/db.json` if Supabase is not reachable or the tables are missing.
- Keep `.env` out of git. It is already gitignored.
