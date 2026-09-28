import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { transcribeRouter } from '../../routes/transcribe.js';
const localFetch = globalThis.fetch;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('retired managed transcription', () => {
  it('cannot spend personal environment keys on GET or POST', async () => {
    vi.stubEnv('DEEPGRAM_API_KEY', 'personal-secret'); vi.stubEnv('GROQ_API_KEY', 'personal-secret');
    const upstream = vi.fn(); vi.stubGlobal('fetch', upstream);
    const app = express(); app.use('/api/transcribe', transcribeRouter); const server = app.listen(0);
    try { const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      for (const method of ['GET', 'POST']) expect((await localFetch(`${origin}/api/transcribe`, { method })).status).toBe(410);
      expect(upstream).not.toHaveBeenCalled();
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
