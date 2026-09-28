export const DEFAULT_FRONTEND_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
];

export function getAllowedCorsOrigins(env = process.env): Set<string> {
  const configuredOrigins = (env.VOID_ALLOWED_ORIGINS ?? env.DASHBOARD_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_FRONTEND_ORIGINS, ...configuredOrigins, ...(env.FRONTEND_URL ? [new URL(env.FRONTEND_URL).origin] : [])]);
}
