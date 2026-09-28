import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// FREEAPI_ENV_PATH lets embedders (e.g. the desktop app, where __dirname sits
// inside a bundle) point at an explicit .env — or at nothing: dotenv silently
// no-ops on a missing file either way.
const explicitEnvPath = process.env.VOID_ENV_PATH || process.env.FREEAPI_ENV_PATH;
const rootEnvPath = path.resolve(__dirname, '../../../.env');
const inheritedPort = process.env.PORT;
const inheritedHost = process.env.HOST;
const isDevLifecycle = process.env.npm_lifecycle_event === 'dev'
  || process.argv.some((argument) => /(?:^|[\\/])tsx(?:\.mjs)?$/i.test(argument));
const isLocalDevelopment = (!explicitEnvPath || path.resolve(explicitEnvPath) === rootEnvPath)
  && (isDevLifecycle || process.env.NODE_ENV !== 'production');
dotenv.config({
  path: explicitEnvPath ?? rootEnvPath,
  // The desktop supervisor is long-lived. In local development it can retain a
  // revoked provider key across child restarts unless the workspace .env wins.
  override: isLocalDevelopment,
});

// Next also keeps local-only provider keys in frontend/.env.local. In development,
// make those configured providers available to the Express router too without
// overriding root or process-level values. Production continues to use only
// its explicit environment.
if (isLocalDevelopment) {
  dotenv.config({
    path: path.resolve(__dirname, '../../../frontend/.env.local'),
    override: false,
  });
}

// Root PORT belongs to Next.js in combined hosting. A supervised or separately
// injected backend binding must survive development credential refreshes.
if (inheritedPort !== undefined) process.env.PORT = inheritedPort;
else if (process.env.BACKEND_PORT) process.env.PORT = process.env.BACKEND_PORT;
if (inheritedHost !== undefined) process.env.HOST = inheritedHost;
