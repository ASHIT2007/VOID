import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 2 && c === 0))) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113));
  }
  // Only global unicast IPv6; exclude mapped IPv4, transition and documentation ranges.
  return isIP(address) === 6 && /^[23]/i.test(address) &&
    !/^2001:(?:0:|db8:|10:|20:)/i.test(address) && !/^2002:/i.test(address);
}

/** DNS-pinned public HTTP download, with validation on every redirect and bounded memory. */
export async function safePublicFetch(value, options = {}, redirects = 0) {
  const { maxBytes = 15 * 1024 * 1024, signal = AbortSignal.timeout(20_000) } = options;
  signal.throwIfAborted();
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port))) throw new Error('URL is not a public HTTP(S) address');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Private network URLs are forbidden');
  const pinned = addresses[0];
  const result = await new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(url, {
      signal,
      headers: { 'User-Agent': 'VOID/1.0', Accept: '*/*', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, opts, callback) => opts.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.destroy(); resolve({ redirect: new URL(res.headers.location, url).href }); return;
      }
      if (Number(res.headers['content-length']) > maxBytes) { res.destroy(); reject(new Error('Download is too large')); return; }
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { res.destroy(); reject(new Error('Download is too large')); } else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const headers = new Headers();
        for (const [name, val] of Object.entries(res.headers)) if (val !== undefined) headers.set(name, Array.isArray(val) ? val.join(', ') : val);
        const status = res.statusCode || 502;
        resolve({ response: new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }) });
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new Error('Download timed out')));
  });
  if (result.redirect) {
    if (redirects >= 3) throw new Error('Too many redirects');
    return safePublicFetch(result.redirect, { maxBytes, signal }, redirects + 1);
  }
  return result.response;
}
