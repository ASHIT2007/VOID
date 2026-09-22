import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// FREEAPI_ENV_PATH lets embedders (e.g. the desktop app, where __dirname sits
// inside a bundle) point at an explicit .env — or at nothing: dotenv silently
// no-ops on a missing file either way.
const explicitEnvPath = process.env.FREEAPI_ENV_PATH;
const isDevLifecycle = process.env.npm_lifecycle_event === 'dev'
  || process.argv.some((argument) => /(?:^|[\\/])tsx(?:\.mjs)?$/i.test(argument));
const isLocalDevelopment = !explicitEnvPath && (isDevLifecycle || process.env.NODE_ENV !== 'production');
dotenv.config({
  path: explicitEnvPath ?? path.resolve(__dirname, '../../../.env'),
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
