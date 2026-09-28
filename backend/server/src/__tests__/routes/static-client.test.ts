import { describe, it, expect, afterEach, vi } from 'vitest';
import { createApp } from '../../app.js';

afterEach(() => vi.unstubAllEnvs());

describe('VOID agent server surface', () => {
  it('does not serve the retired dashboard even when CLIENT_DIST is set', async () => {
    vi.stubEnv('CLIENT_DIST', process.cwd());
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      expect((await fetch(base)).status).toBe(404);
      expect((await fetch(`${base}/dashboard`)).status).toBe(404);
      expect((await fetch(`${base}/api/ping`)).status).toBe(200);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
