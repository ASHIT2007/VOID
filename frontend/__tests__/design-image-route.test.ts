import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), generate: vi.fn(), fetch: vi.fn(), hasKey: true }));
vi.mock('@/lib/deployment-access', () => ({ requireDeploymentAccess: () => null }));
vi.mock('@/app/api/generate-image/route', () => ({ POST: mocks.generate }));
vi.mock('@/lib/ai/server', () => ({ authenticatedUser: mocks.auth, loadByokContext: async () => ({ userId: 'owner', mode: 'AUTO', models: [] }), serviceDb: () => ({ from: (table: string) => {
  const query = { select: () => query, eq: () => query, in: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, data: table === 'provider_connections'
      ? [{ id: 'provider', capability_usage: { image: true } }] : mocks.hasKey ? [{ id: 'model', capabilities: { imageGeneration: true } }] : [] }).then(resolve) };
  return query;
} }) }));
import { POST } from '@/app/api/design-image/route';
const request = (source = 'auto') => new NextRequest('http://localhost:3000/api/design-image', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-void-user-token': 'test-session' }, body: JSON.stringify({ subject: 'Snow leopard', prompt: 'A supporting habitat illustration', grounding: 'Snow leopards live in mountains.', source, format: 'presentation' }) });
beforeEach(() => { mocks.hasKey = true; mocks.auth.mockReset().mockResolvedValue('owner'); mocks.generate.mockReset(); mocks.fetch.mockReset(); vi.stubGlobal('fetch', mocks.fetch); });
describe('authenticated presentation image policy', () => {
  it('uses only the user model for illustration slots', async () => {
    mocks.generate.mockResolvedValue(Response.json({ url: '/api/generated-image/00000000-0000-4000-8000-000000000001.png', modelUsed: 'User selected model' }));
    const response = await POST(request()); expect(response.status).toBe(200); expect((await response.json()).generated).toBe(true);
    expect(await mocks.generate.mock.calls[0][0].json()).toMatchObject({ connectedOnly: true }); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('does not silently substitute web or managed imagery when a connected model fails', async () => {
    mocks.generate.mockResolvedValue(Response.json({ error: 'Quota exhausted' }, { status: 429 }));
    const response = await POST(request()); expect(response.status).toBe(429); expect(await response.json()).toMatchObject({ code: 'generation_failed', error: expect.stringContaining('image model') });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each(['no key', 'documentary'])('uses grounded web references for %s', async mode => {
    mocks.hasKey = mode !== 'no key'; mocks.fetch.mockResolvedValue(Response.json({ images: [{ url: 'https://upload.wikimedia.org/Snow_leopard.jpg', verified: true, title: 'Snow leopard', sourceUrl: 'https://en.wikipedia.org/wiki/Snow_leopard' }] }));
    const response = await POST(request(mode === 'documentary' ? 'reference' : 'auto'));
    expect((await response.json()).generated).toBe(false); expect(mocks.generate).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ grounding: 'Snow leopards live in mountains.', subjects: ['Snow leopard'] });
  });
  it('omits empty reference results and requires authentication', async () => {
    mocks.hasKey = false; mocks.fetch.mockResolvedValue(Response.json({ images: [] }));
    expect(await (await POST(request())).json()).toMatchObject({ omitted: true, generated: false });
    mocks.auth.mockResolvedValue(null); expect((await POST(request())).status).toBe(401);
  });
});
