# Deploying VOID

## Supported deployment boundary

Run the active web application on a persistent Node.js host or Docker host. It uses an Express process, SQLite, local attachment/image files, and streaming responses. A static host such as GitHub Pages cannot run the full application. Keep one backend replica unless you redesign storage and in-memory agent sessions.

The provided deployment is for trusted users. Several chat, voice, attachment, and image routes do not verify a user session server-side. Supabase browser sign-in does not protect these routes. Protect the entire frontend and any exposed backend endpoints with an authenticated HTTPS reverse proxy or VPN; keep port 3001 private. Configure the proxy to allow long requests, streaming without response buffering, and WebSocket upgrades. Public multi-user hosting needs server-side authentication, per-user authorization/storage isolation, and abuse controls first.

The dependency refresh removes the known critical production dependency findings at preparation time. `npm audit --omit=dev` still reports moderate/high findings, including spreadsheet parsing and document/image dependencies; the full audit also includes older Electron/build tooling. Do not treat this preparation as a completed security audit or expose file-processing APIs to untrusted users. Re-run the audit against the root lockfile before release and address remaining findings before public hosting.

## Docker Compose

1. Install Docker with Compose on your host and clone this repository.
2. Copy `.env.example` to `.env`. Generate a persistent `ENCRYPTION_KEY` using the command in the README and save it in `.env`. Add provider credentials and public Supabase configuration.
3. Build and start:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 void
```

The app listens on host loopback port 3000 and the built administration dashboard on loopback port 3001. Open the dashboard locally and create the initial operator account before granting remote access. For a remote machine, use a secure tunnel or authenticated proxy to reach those loopback ports.

Compose stores the gateway database and attachments, generated images, and generated posters in three named volumes. Back up these volumes and the encryption key together. Stop the service or use SQLite's backup mechanism for consistent database backups. `docker compose down` preserves volumes; `docker compose down -v` deletes them.

Public Supabase variables are build arguments and are embedded in the browser bundle. Rebuild after changing them. API provider keys remain runtime environment variables and are never Docker build arguments. `.dockerignore` excludes local secrets, databases, and generated output from the image context.

The container runs as the unprivileged `node` user. The image retains workspace build dependencies for compatibility with the current monorepo; image-size optimization can be handled separately. Docker must be available to verify the image; CI builds it on Linux.

## Native Node.js or separate services

```sh
npm ci
npm test
npm run build
npm start
```

The combined supervisor explicitly enables production mode, starts Express on `BACKEND_PORT` (default 3001), waits for `/api/ping`, and starts Next.js on `PORT` (default 3000). Set `BACKEND_URL` to the same local backend address when overriding the backend port. Set `FRONTEND_URL` to the local Next.js address when changing the frontend port; image-generation tools call it from the backend. Set these values in the process environment, since the supervisor reads them before either service loads dotenv files.

For separate services, run `npm run start:backend` with `NODE_ENV=production`, its own `PORT`, `ENCRYPTION_KEY`, and provider keys. Run `npm run start:frontend` with `NODE_ENV=production`, its own `PORT`, server-only frontend provider keys, and `BACKEND_URL` pointing to the private backend. Set the backend's `FRONTEND_URL` for its image-generation calls. Configure `DASHBOARD_ORIGINS` with the exact allowed browser origins. CORS is not authentication.

The backend loads the root `.env` unless `FREEAPI_ENV_PATH` overrides it. Next.js loads `frontend/.env.local` for local runs; production hosts should inject environment variables directly. Set frontend and backend provider credentials independently if splitting the services. Never prefix provider keys or Supabase service-role keys with `NEXT_PUBLIC_`.

Persist `backend/server/data`, root `data`, and `frontend/public/generated_posters`. The root build places dashboard assets in `frontend/admin-dashboard/dist`, which the backend serves automatically. Readiness is available at backend `/api/ping`.

## Supabase and optional features

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` before the frontend build. Configure your deployed origin in Supabase authentication redirect settings. Apply the supplied migration under `backend/supabase/migrations` only after reviewing it for your project. It creates attachment storage support; this repository does not contain a complete baseline migration for every application table. Export and version your existing project schema before setting up a fresh Supabase project, and enable user-scoped row-level policies for application data. Do not export production rows or secrets into Git.

Optional image workers require their own endpoint and server-only key. The Python Windows agent and Electron app run on user devices; the web container does not start them. FreeLLMAPI model routing requires provider keys configured through its dashboard; optional environment-based providers vary by feature.

## Updating

Back up storage and the encryption key, pull the desired Git commit, then run `docker compose up -d --build`. Check the container health and test sign-in, chat, attachments, and any configured voice/image providers. Changing or losing the encryption key prevents decrypting saved provider credentials.
