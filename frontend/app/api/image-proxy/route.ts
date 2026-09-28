import { requireDeploymentAccess } from '@/lib/deployment-access';
import { safePublicFetch } from '@void/shared/safe-fetch.mjs';

export async function GET(request: Request) {
  const denied = requireDeploymentAccess(request);
  if (denied) return denied;
  const url = new URL(request.url).searchParams.get('url');
  if (!url) return new Response('Missing URL', { status: 400 });
  try {
    const response = await safePublicFetch(url, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]) });
    if (!response.ok) return new Response('Image unavailable', { status: 502 });
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(type)) {
      return new Response('Unsupported image format', { status: 415 });
    }
    return new Response(response.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return new Response('Image URL is blocked or unavailable', { status: 400 });
  }
}
