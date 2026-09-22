import { NextResponse } from 'next/server';

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  try {
    const targetUrl = new URL(url);
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return new NextResponse('Invalid URL protocol', { status: 400 });
    }
    if (isPrivateHost(targetUrl.hostname)) {
      return new NextResponse('Private network URLs are not allowed', { status: 400 });
    }

    const isWikimedia = targetUrl.hostname.includes("wikimedia.org") || targetUrl.hostname.includes("wikipedia.org");
    const userAgent = isWikimedia
      ? "ChatAIStudentApp/1.0 (Wikimedia Integration; contact@chataistudent.com)"
      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    const response = await fetch(targetUrl.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (response.ok) {
      const contentType = response.headers.get('Content-Type') || '';
      if (!contentType.toLowerCase().startsWith('image/')) {
        return new NextResponse('Upstream response is not an image', { status: 415 });
      }
      const declaredLength = Number(response.headers.get('Content-Length') || 0);
      if (declaredLength > 15 * 1024 * 1024) {
        return new NextResponse('Image is too large', { status: 413 });
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 15 * 1024 * 1024) {
        return new NextResponse('Image is too large', { status: 413 });
      }
      const headers = new Headers();
      headers.set('Content-Type', contentType);
      headers.set('Cache-Control', 'public, max-age=86400');
      headers.set('Access-Control-Allow-Origin', '*');
      return new NextResponse(buffer, { headers });
    }
  } catch {
    // ignore
  }

  return new NextResponse('Image not found or failed to load', { status: 404 });
}
