# VOID deployment guide

## Supported release

Run **one private, trusted-user instance** on a persistent Docker/Node host. The app needs streaming, WebSockets and persistent files. The active workspaces are Next.js `frontend`, `backend/server` (`@void/agent-server`) and `shared` (`@void/shared`). There is no separate dashboard or runtime SQLite key pool. The optional Windows desktop agent is outside the web release.

Production requires private deployment credentials before Supabase sign-in. Each frontend API checks access independently; AI calls between services require `VOID_INTERNAL_KEY`. Missing configuration fails closed. Send Basic credentials only over HTTPS or an encrypted tunnel. These credentials grant access to the whole instance, including local media. Supabase policies isolate cloud conversations, but shared agent state/local files and client-side plan counters are **not suitable for public multi-tenant SaaS, billing or quotas**. Disable Supabase signup and invite trusted accounts.

## Database and authentication

1. Create a Supabase project or back up your existing schema/data.
2. Apply all SQL files in `backend/supabase/migrations` in filename order: attachments, application schema/RLS, BYOK and provider orchestration. They supply application tables, profile triggers, owner policies and server-only encrypted provider storage. Review existing column types/custom policies in staging first.
3. Set the Auth Site URL to `https://YOUR_DOMAIN`; allow that origin and `https://YOUR_DOMAIN/update-password` in redirect settings. Invite your account and configure SMTP for recovery/invitation email.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project URL and anon/publishable key. These are public build-time values. Never expose a service-role key.
5. Verify two invited accounts cannot see each other's conversations, messages, folders or snippets. `npm run test:database` checks the migration in embedded Postgres, not your hosted project's settings.

**Existing attachments:** the migration makes the old `chat-attachments` bucket private; historical public URLs stop working. Back up/inventory objects first. Migrate each owner's files to the protected API and update their message references, or add owner-scoped private storage retrieval. Old randomly named objects do not contain trustworthy ownership information, so this cannot be inferred automatically. New uploads use the protected API and persistent backend volume, with a 25 MiB maximum. Local previews are the default; external Office/Google viewers are opt-in.

## Server setup

Install Docker Engine and Compose, then clone and configure:

```sh
git clone https://github.com/ASHIT2007/VOID.git
cd VOID
cp .env.example .env
chmod 600 .env
```

Generate three **different** secrets, saving each output in a password manager and the appropriate environment field:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Without Node installed, use `docker run --rm node:24.13.0-bookworm-slim node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

| Setting | Purpose |
| --- | --- |
| `ENCRYPTION_KEY` | 64 hex characters; retain permanently with DB backups. |
| `VOID_ACCESS_USER` | Private login name, e.g. operator; no colon. |
| `VOID_ACCESS_PASSWORD` | Random private access password, at least 24 characters. |
| `VOID_INTERNAL_KEY` | Separate service secret, at least 32 characters; identical on frontend/backend. |
| `VOID_DOMAIN` | DNS hostname only, e.g. void.example.com. |
| `VOID_ALLOWED_ORIGINS` | Include https://YOUR_DOMAIN for voice and any local frontend origins you use. |
| Supabase public settings | From above; rebuild when changed. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Next.js credential for owned encrypted provider records. |
| Provider credentials | Runtime secrets; configure only providers/features you use. |

For unprotected local development, leave all three access settings empty. Never deploy development mode. Never prefix provider, service or encryption secrets with `NEXT_PUBLIC_`.

## Deploy frontend, backend and HTTPS

Point your domain's A/AAAA records to the server. Permit 80/443 and restrict SSH. Compose publishes only frontend port 3000 on loopback; backend port 3001 remains inside Docker networking. The overlay publishes Caddy.

```sh
docker compose -f compose.yaml -f compose.https.yaml up -d --build
docker compose -f compose.yaml -f compose.https.yaml ps
docker compose -f compose.yaml -f compose.https.yaml logs --tail=100 void caddy
```

Caddy manages HTTPS, streams responses and forwards the voice socket path to the backend. Native/PaaS hosting forwards the same path through Next.js on the public port. Voice requires a one-use ticket expiring after 60 seconds. Legacy dashboard and /v1 endpoints return 404. Avoid request-header/query logging because they can contain credentials/tickets.

Open https://YOUR_DOMAIN, enter deployment credentials, then sign in with your invited Supabase account. Basic credentials remain cached independently of Supabase logout. Use a dedicated browser profile on shared computers; rotate the private password to revoke access.

## Configure user providers

Sign in and open Settings → AI Providers to connect, discover and select models. Provider credentials are AES-256-GCM encrypted in Supabase and decrypted only within the backend request. Set the same `ENCRYPTION_KEY` and `VOID_INTERNAL_KEY` on both services. Configure provider-side spending limits.

Managed chat is available when `GROQ_API_KEY` is configured, subject to the frontend's authenticated account policy. `VOID_MANAGED_GROQ_MODEL` selects the managed model. `VOID_ALLOW_FREE_CHAT=false` disables non-admin managed chat and the unscoped internal fallback. A BYOK context never falls through to the old shared key pool.

For Railway, Render or another persistent Node host, use `npm ci && npm run build` as the build command and `npm start` as the start command. Inject production credentials and Supabase configuration. The supervisor uses the platform's `PORT`, starts the backend on a distinct `BACKEND_PORT`, waits for `/api/ping`, and starts Next.js. Use `/api/health` for the public health check. Configure persistent disks for the three file-storage paths below. Hosts must support long streaming requests and WebSocket upgrades.

Optional image workers require your configured endpoint and key; this build does not provision a worker. Host file/code execution is disabled in production. Restoring that feature safely requires a separate isolated sandbox.

## Separate hosts

Build from the repository root on each host:

```sh
npm ci
npm test
npm run test:database
npm run build
```

| Service | Start command | Runtime settings |
| --- | --- | --- |
| Frontend | `npm run start:frontend` | NODE_ENV=production, PORT, access credentials, VOID_INTERNAL_KEY, private BACKEND_URL, frontend provider keys. Persist root data and frontend/public/generated_posters. |
| Agent backend | `npm run start:backend` | NODE_ENV=production, PORT, HOST as needed, ENCRYPTION_KEY, VOID_INTERNAL_KEY, provider keys, FRONTEND_URL, VOID_ALLOWED_ORIGINS. Persist backend/server/data for attachments. |

Use private networking or HTTPS between hosts. FRONTEND_URL must reach the frontend for image generation. Next.js forwards `/api/voice-stream` to its runtime BACKEND_URL; an external proxy can also forward only that path. `VOICE_PUBLIC_WS_URL` optionally selects another public WSS endpoint. Never return private backend IPs to browsers. Keep one backend replica: voice tickets and agent sessions are instance-local. Allow long AI requests and streaming.

Combined `npm start` loads root .env before starting both services, preserving injected environment values. `VOID_ENV_PATH` can select another file. Separately started Next loads frontend environment files or injected variables; Express loads root .env unless VOID_ENV_PATH overrides it (FREEAPI_ENV_PATH remains a compatibility alias).

## Release checks and backups

- Frontend /api/health and backend /api/ping test liveness, not provider/Supabase credentials.
- Anonymous frontend AI/media routes must reject access. Direct backend AI routes require the service key. Retired dashboard/proxy routes must return 404, and invalid voice tickets must be rejected.
- In staging, test login, recovery, logout, history reload, uploads, streamed chat, voice and each configured image provider. Confirm no provider/service secrets appear in browser responses or bundles.
- Require passing GitHub Actions for the pushed commit, including Linux Docker build/smoke checks. Re-run npm audit before release; a clean result is not a security guarantee.
- Back up all three app file volumes, encryption key and Supabase separately. Keep the app stopped during a consistent file snapshot. Practice restoring to staging. Do not delete production volumes.
- Update by backing up, pulling a tested commit and repeating the Compose command. Roll back to a previous tested commit with a compatible database snapshot when necessary.

References: [Caddy HTTPS](https://caddyserver.com/docs/automatic-https), [Caddy streaming/WebSockets](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Docker volumes](https://docs.docker.com/engine/storage/volumes/), [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Supabase storage policies](https://supabase.com/docs/guides/storage/security/access-control).
