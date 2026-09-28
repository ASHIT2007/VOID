import { requireDeploymentAccess } from '@/lib/deployment-access';
import { randomBytes } from 'node:crypto';
export async function GET(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  // Next's internal URL can use 0.0.0.0 behind the local supervisor/proxy.
  const address = new URL(request.url);
  address.host = request.headers.get('x-forwarded-host') || request.headers.get('host') || address.host;
  if (request.headers.get('x-forwarded-proto') === 'https') address.protocol = 'https:';
  const origin = address.origin;
  const nonce = randomBytes(18).toString('base64');
  const policy = `default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' blob: ${origin}/sandbox-runtime/; worker-src blob:; connect-src ${origin}/sandbox-runtime/; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`;
  const script = `
    let worker, started = false;
    const send = value => parent.postMessage(value, '*');
    addEventListener('message', async event => {
      if (event.source !== parent || event.data?.type !== 'run' || started) return;
      started = true; const id = event.data.id;
      const timer = setTimeout(() => { worker?.terminate(); send({ type: 'timeout', id }); }, 30000);
      try {
        const response = await fetch(${JSON.stringify(origin + '/sandbox-runtime/worker.js')});
        if (!response.ok) throw Error('Runtime assets unavailable.');
        const source = await response.text();
        worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
        worker.onmessage = event => {
          const data = event.data;
          if (data?.type === 'status') send({ type: 'status', id, text: String(data.text || '').slice(0, 200) });
          if (data?.type === 'result') {
            clearTimeout(timer); worker.terminate();
            send({ type: 'result', id, success: data.success === true, output: String(data.output || '').slice(0, 40000), error: String(data.error || '').slice(0, 1500) });
          }
        };
        worker.onerror = () => { clearTimeout(timer); worker.terminate(); send({ type: 'result', id, success: false, error: 'The isolated runtime could not start.' }); };
        worker.postMessage({ code: event.data.code, language: event.data.language, base: ${JSON.stringify(origin + '/sandbox-runtime')} });
      } catch (error) { clearTimeout(timer); send({ type: 'result', id, success: false, error: String(error.message).slice(0, 1500) }); }
    });
    send({ type: 'ready' });`;
  return new Response(`<!doctype html><html><head><meta charset="utf-8"></head><body><script nonce="${nonce}">${script}</script></body></html>`, {
    headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' } });
}
