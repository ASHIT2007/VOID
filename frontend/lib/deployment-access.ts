import { createHash, timingSafeEqual } from 'node:crypto';

function equal(actual: string, expected: string): boolean {
  return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());
}

/** Private deployment perimeter. Supabase sign-in alone does not gate API routes. */
export function requireDeploymentAccess(request: Request): Response | null {
  const user = process.env.VOID_ACCESS_USER;
  const password = process.env.VOID_ACCESS_PASSWORD;
  const internal = process.env.VOID_INTERNAL_KEY;
  if (!user && !password && process.env.NODE_ENV !== 'production') return null;
  if (!user || !password || password.length < 24 || !internal || internal.length < 32) {
    return Response.json({ error: 'Deployment access is not configured.' }, { status: 503 });
  }
  // Service credentials can call APIs, never authenticate a browser page.
  if (new URL(request.url).pathname.startsWith('/api/') && equal(request.headers.get('x-void-internal-key') || '', internal)) return null;
  const auth = request.headers.get('authorization') || '';
  if (/^Basic /i.test(auth)) {
    const credentials = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    if (equal(credentials, `${user}:${password}`)) {
      // Block cross-site use of ambient Basic credentials, including costly GET APIs.
      const site = request.headers.get('sec-fetch-site');
      if (site === 'cross-site' && new URL(request.url).pathname.startsWith('/api/')) {
        return Response.json({ error: 'Cross-site API access is forbidden.' }, { status: 403 });
      }
      return null;
    }
  }
  return new Response('Authentication required', { status: 401, headers: {
    'WWW-Authenticate': 'Basic realm="VOID private deployment", charset="UTF-8"',
    'Cache-Control': 'no-store',
  } });
}
