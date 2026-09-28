import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import { Readable } from 'node:stream';
import { isPublicAddress } from '@void/shared/safe-fetch.mjs';

/** DNS pinned outbound request for user configured provider URLs. */
export async function safeProviderRequest(value: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Custom provider URL must use public HTTPS');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error('Custom provider URL cannot target a private network');
  }
  const pinned = addresses[0];
  return new Promise<Response>((resolve, reject) => {
    const headers = new Headers(init.headers);
    const request = https.request(url, { method: init.method || 'GET', headers: Object.fromEntries(headers),
      signal: init.signal || undefined, timeout: timeoutMs,
      lookup: (_name, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
    }, response => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.destroy();
        reject(new Error('Custom provider redirects are not allowed'));
        return;
      }
      resolve(new Response(Readable.toWeb(response) as ReadableStream, { status: response.statusCode || 502, headers: responseHeaders }));
    });
    request.on('timeout', () => request.destroy(new Error('Custom provider timed out')));
    request.on('error', reject);
    if (typeof init.body === 'string') request.write(init.body);
    request.end();
  });
}
