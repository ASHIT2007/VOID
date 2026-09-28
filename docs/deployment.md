# Deploying VOID

Use [the release deployment guide](deployment-release.md) for credentials, Supabase migrations, HTTPS and backups.

The supported workspace contains Next.js `frontend`, Express `backend/server` and `shared`. The duplicate FreeLLMAPI checkout, admin dashboard and alternate UI are retired. Production startup does not create a SQLite key pool. User provider credentials are encrypted in Supabase and scoped to authenticated requests.

## Docker

Copy `.env.example` to `.env`, configure the production access credentials, encryption key, internal service key, Supabase and any managed providers, then run:

```sh
docker compose up -d --build
docker compose ps
```

Only frontend port 3000 is published on host loopback. Backend port 3001 is available inside Docker networking. The HTTPS overlay adds Caddy:

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

Public Supabase values are build arguments; provider credentials are runtime settings. The image runs as the unprivileged `node` user. Health probes check frontend `/api/health` and backend `/api/ping`. Neither liveness probe validates external providers.

## Native Node.js and persistent PaaS hosting

Use Node 24.x and npm 11.x. Railway, Render and similar persistent Node hosts can use `npm ci && npm run build` to build and `npm start` to run.

```sh
npm ci
npm test
npm run test:database
npm run test:frontend
npm run build
npm run test:production
npm start
```

The supervisor preserves injected environment values, loads root `.env` (or `VOID_ENV_PATH`), starts the agent on `BACKEND_PORT` (default 3001), waits for `/api/ping`, then starts Next.js on the platform's `PORT` (default 3000). It derives local `BACKEND_URL` and `FRONTEND_URL` if omitted. `FRONTEND_PORT` remains a local compatibility fallback when `PORT` is unset. The two ports must differ. The backend binds loopback unless `BACKEND_HOST` is explicitly supplied.

Live voice uses `/api/voice-stream` on the public frontend port; Next.js forwards upgrades to runtime `BACKEND_URL`. The backend validates a one-use ticket that expires after 60 seconds. Configure the public origin in `VOID_ALLOWED_ORIGINS`, and enable long streaming requests and WebSocket upgrades on the host.

For separate services use `npm run start:frontend` and `npm run start:backend`. Inject `NODE_ENV=production`, each service's `PORT`, matching `VOID_INTERNAL_KEY` and `ENCRYPTION_KEY`, the frontend's private `BACKEND_URL`, and the backend's reachable `FRONTEND_URL`. Configure `HOST` for network binding and keep the backend private. `SUPABASE_SERVICE_ROLE_KEY` belongs only on Next.js. Never prefix credentials with `NEXT_PUBLIC_`.

## Storage and updates

Persist `backend/server/data` for attachments, root `data` for generated images and `frontend/public/generated_posters`. Supabase owns application history and encrypted provider connections. Apply all supplied migrations in filename order and configure your deployed origin in Supabase Auth redirects.

Back up these file volumes, Supabase and the encryption key before updates. Then rebuild, check liveness and verify sign-in, streamed chat, attachments and configured voice/image providers in staging. Changing or losing the encryption key prevents decrypting saved provider credentials.
