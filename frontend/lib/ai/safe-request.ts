import 'server-only';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { Readable } from 'node:stream';
import { isPublicAddress } from '@void/shared/safe-fetch.mjs';

/** Resolve and pin public DNS before sending a user credential to a custom API. */
export async function safeCustomRequest(value: string, headers: Record<string, string>, body?: string): Promise<Response> {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Custom providers need public HTTPS');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Custom providers need public HTTPS');
  const pinned = addresses[0];
  return new Promise<Response>((resolve, reject) => {
    const request = https.request(url, { method: body ? 'POST' : 'GET', headers, timeout: 15_000,
      lookup: (_name, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
    }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.destroy(); reject(new Error('Custom provider redirects are not allowed')); return;
      }
      const responseHeaders = new Headers();
      for (const [name, val] of Object.entries(response.headers)) if (val !== undefined) responseHeaders.set(name, Array.isArray(val) ? val.join(', ') : val);
      resolve(new Response(Readable.toWeb(response) as ReadableStream, { status: response.statusCode || 502, headers: responseHeaders }));
    });
    request.on('timeout', () => request.destroy(new Error('Custom provider timed out')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}
