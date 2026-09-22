import path from 'path';
import fs from 'fs';

export const DEFAULT_DASHBOARD_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
];

export function getAllowedCorsOrigins(env = process.env): Set<string> {
  const configuredOrigins = (env.DASHBOARD_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_DASHBOARD_ORIGINS, ...configuredOrigins]);
}

export function resolveClientDist(options: {
  cwd?: string;
  dirname: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const candidatePaths = [
    env.CLIENT_DIST ? path.resolve(env.CLIENT_DIST) : null,
    path.resolve(options.dirname, '../../../frontend/admin-dashboard/dist'),
    path.resolve(cwd, 'freellmapi/client/dist'),
    path.resolve(cwd, 'client/dist'),
    path.resolve(options.dirname, '../../client/dist'),
    path.resolve(options.dirname, '../../../freellmapi/client/dist'),
    path.resolve(options.dirname, '../../../../freellmapi/client/dist'),
    path.resolve(cwd, '../client/dist'),
  ].filter((p): p is string => Boolean(p));

  return candidatePaths.find(p => fs.existsSync(path.join(p, 'index.html')))
    ?? candidatePaths[0]
    ?? path.resolve(options.dirname, '../../client/dist');
}
