// Load local provider credentials before any routes or clients initialize.
import './env.js';
import { createApp } from './app.js';
import { initEncryptionKey } from './lib/crypto.js';
import { attachVoiceWebSocket } from './realtime/voice-socket.js';

const PORT = process.env.PORT ?? 3001;
// Native hosting is private by default; containers explicitly set HOST=0.0.0.0.
const HOST = process.env.BACKEND_HOST ?? process.env.HOST ?? '127.0.0.1';

async function main() {
  // BYOK credentials live in Supabase; startup must not create a legacy key pool.
  initEncryptionKey();
  const app = createApp();

  const onReady = (host: string) => () => {
    const display = host.includes(':') ? `[${host}]` : host;
    console.log(`Server running on http://${display}:${PORT}`);
  };

  const server = app.listen(Number(PORT), HOST, onReady(HOST));
  attachVoiceWebSocket(server);
  server.on('error', (err: NodeJS.ErrnoException) => {
    // The default '::' bind fails where IPv6 is disabled (kernel
    // ipv6.disable=1 and the like) — retry IPv4-only rather than dying.
    // Anything else (EADDRINUSE, an explicit HOST that can't bind) keeps the
    // fail-fast posture documented in main().catch below.
    if (!process.env.BACKEND_HOST && !process.env.HOST && (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')) {
      console.warn('[server] IPv6 unavailable on this host — falling back to 0.0.0.0 (IPv4-only)');
      const fallbackServer = app.listen(Number(PORT), '0.0.0.0', onReady('0.0.0.0'));
      attachVoiceWebSocket(fallbackServer);
      return;
    }
    console.error('\n[server] Failed to start:\n  ' + (err?.message ?? err) + '\n');
    process.exit(1);
  });
}

main().catch((err) => {
  // A boot failure (e.g. a missing production ENCRYPTION_KEY) must exit
  // non-zero rather than leaving a half-initialized process that never starts
  // listening — that silent state is what surfaces in the client as
  // "Can't reach the server".
  console.error('\n[server] Failed to start:\n  ' + (err?.message ?? err) + '\n');
  process.exit(1);
});
