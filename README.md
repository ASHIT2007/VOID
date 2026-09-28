# VOID

VOID is a multi-model AI assistant with a Next.js chat interface, an Express agent engine, user-scoped AI providers, voice, attachments, and image generation. Provider availability, quotas, and charges depend on the services you configure.

See [the complete skills and tools inventory](docs/void-capabilities.md) for implemented workflows, all 29 function tools and runtime availability. The device workspace provides isolated Python/JavaScript, real Office/PDF downloads, local memories and inspectable usage/routing.

## Quick start

Use Node.js **24.13+ (24.x)** and npm **11.x**. From the repository root:

```sh
npm ci
cp .env.example .env
cp frontend/.env.example frontend/.env.local
npm run dev
```

On PowerShell, replace `cp` with `Copy-Item`. The app runs at `http://localhost:3000`; its supervised agent backend uses loopback port 3001. Signed-in users connect provider keys in Settings → AI Providers.

For frontend sign-in and cloud history, configure your Supabase URL and **anon** key in `frontend/.env.local`. Your Supabase project also needs the application tables, storage policies, and authentication redirects; see [deployment instructions](docs/deployment.md). The interface can build without credentials, but external-service features require their configuration.

## User AI providers

Apply `backend/supabase/migrations/20260924000000_byok.sql` after the application schema migration. Set `SUPABASE_SERVICE_ROLE_KEY` only on the Next.js server, the same 64-character `ENCRYPTION_KEY` on Next.js and Express, and the same random `VOID_INTERNAL_KEY` (at least 32 characters) on both servers. Keep all three server-only. In Settings → AI Providers, each signed-in user can connect one provider key; VOID discovers models and routes chat through that user's models. Production chat requires BYOK storage configuration. Provider keys are AES-256-GCM encrypted before database insertion; the browser only receives a masked label.

Apply the provider orchestration migration next. Authenticated BYOK routing stays within the user's connected model set. The legacy dashboard, proxy endpoints, duplicate checkout and alternate UI scaffold have been removed. Backend startup no longer opens a SQLite key pool; managed internal chat can use `GROQ_API_KEY` and `VOID_MANAGED_GROQ_MODEL` when configured. See [the architecture guide](docs/byok-architecture.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend and supervised agent backend |
| `npm run build` | Compile Next.js and the agent server |
| `npm test` | Run backend unit and integration tests |
| `npm run test:frontend` | Run presentation quality and image fallback tests |
| `npm run test:database` | Verify migrations and database access boundaries in PGlite |
| `npm run test:production` | Smoke-test the built app and production security |
| `npm start` | Start the built frontend and gateway together in production mode |
| `npm run start:frontend` | Start only Next.js, for separately hosted services |
| `npm run start:backend` | Start only the built Express gateway |
| `npm run check:repository` | Check tracked/staged files for common secrets and generated data |

`npm start` requires an explicit 64-character hexadecimal `ENCRYPTION_KEY`. Generate it with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Repository layout

| Directory | Role |
| --- | --- |
| `frontend/` | Active Next.js application and API routes |
| `backend/server/` | Express agent engine, tools, providers, and tests |
| `backend/supabase/` | Supabase function and available migrations |
| `shared/` | Shared TypeScript types |
| `scripts/` | App supervision and repository checks |
| `desktop-agent/` | Optional Windows Python voice assistant |
| `workers/` | Optional image-to-image worker source |

The root npm workspaces are `frontend`, `backend/server` (`@void/agent-server`), and `shared` (`@void/shared`). Historical proxy modules remain only to support regression fixtures; VOID does not mount those APIs or initialize their database.

## Deployment

See [the release deployment guide](docs/deployment-release.md) for Docker, Railway/Render-style Node hosting, Supabase migrations, credentials and persistent storage. The supervisor honors `PORT` (default 3000) and keeps `BACKEND_PORT` (default 3001) internal. Live voice shares the public frontend port. Production requires private deployment credentials and authenticated service calls. This release supports a trusted private instance; shared local media and agent state are not a public multi-tenant service.

GitHub Actions checks repository hygiene, tests, all active web builds, and the deployment image. Environment files, local databases, generated media, dependency directories, and one-off credential experiments are deliberately excluded from Git.

## Attribution

The agent server and shared types include code derived from FreeLLMAPI. Its MIT notice is preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No additional license is granted here for VOID-specific code.
