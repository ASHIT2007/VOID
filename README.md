# VOID

VOID is a multi-model AI assistant with a Next.js chat interface, an Express LLM gateway, an administration dashboard, voice features, attachments, and image generation. Provider availability, quotas, and charges depend on the services you configure.

## Quick start

Use Node.js **24.13+ (24.x)** and npm **11.x**. From the repository root:

```sh
npm ci
cp .env.example .env
cp frontend/.env.example frontend/.env.local
npm run dev
```

On PowerShell, replace `cp` with `Copy-Item`. Add the provider keys you need to the local environment files. The app runs at `http://localhost:3000`, the gateway at `http://localhost:3001`, and the Vite administration dashboard normally at `http://localhost:5173` (check its terminal output). Create the first dashboard account locally and add provider keys there for gateway model routing.

For frontend sign-in and cloud history, configure your Supabase URL and **anon** key in `frontend/.env.local`. Your Supabase project also needs the application tables, storage policies, and authentication redirects; see [deployment instructions](docs/deployment.md). The interface can build without credentials, but external-service features require their configuration.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend, supervised gateway, and dashboard development server |
| `npm run build` | Compile the frontend, backend, and dashboard |
| `npm test` | Run backend unit and integration tests |
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
| `frontend/admin-dashboard/` | Active Vite gateway dashboard |
| `backend/server/` | Active Express gateway, SQLite storage, and tests |
| `backend/supabase/` | Supabase function and available migrations |
| `shared/` | Shared TypeScript types |
| `scripts/` | App supervision and repository checks |
| `desktop-agent/` | Optional Windows Python voice assistant |
| `freellmapi/` | Retained FreeLLMAPI source and optional Electron desktop application |
| `workers/` | Optional image-to-image worker source |
| `web/` | Retained alternate UI scaffold; not an active root workspace |

The root npm workspace is the supported web build. `freellmapi/server` and `freellmapi/client` are retained sources; active web code lives in `backend/server` and `frontend/admin-dashboard`. Desktop packaging and optional workers have separate workflows and are not part of the web deployment checks.

## Deployment

See [docs/deployment.md](docs/deployment.md) for Docker Compose, environment variables, persistent storage, and separate-service hosting. The supplied Compose deployment binds to localhost. Several AI endpoints currently assume trusted access: put the complete app behind an authenticated HTTPS proxy or VPN before making it reachable remotely. This repository is not yet a public multi-tenant service.

GitHub Actions checks repository hygiene, tests, all active web builds, and the deployment image. Environment files, local databases, generated media, dependency directories, and one-off credential experiments are deliberately excluded from Git.

## Attribution

Gateway, dashboard, shared types, and desktop components include code derived from FreeLLMAPI. Its MIT notice is preserved in [freellmapi/LICENSE](freellmapi/LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No additional license is granted here for VOID-specific code.
