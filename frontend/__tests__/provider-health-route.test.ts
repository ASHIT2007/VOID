import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ owner: 'owner', denied: null as Response | null, fetch: vi.fn(), eq: vi.fn(), inside: vi.fn() }));
vi.mock('@/lib/deployment-access', () => ({ requireDeploymentAccess: () => mocks.denied }));
vi.mock('@/lib/ai/server', () => ({ authenticatedUser: async () => mocks.owner, serviceDb: () => ({ from: (table: string) => ({ select: () => table === 'provider_connections' ? { eq: mocks.eq } : { in: mocks.inside } }) }) }));
vi.mock('@/lib/backend', () => ({ backendUrl: (path: string) => `http://backend${path}`, backendHeaders: () => new Headers({ 'x-void-internal-key': 'internal', 'Content-Type': 'application/json' }) }));
import { GET } from '@/app/api/ai/health/route';
const request = () => new Request('http://localhost/api/ai/health?userId=foreign-user');

beforeEach(() => {
  mocks.owner = 'owner'; mocks.denied = null;
  mocks.eq.mockResolvedValue({ data: [{ id: 'owned-key' }], error: null });
  mocks.inside.mockResolvedValue({ data: [{ id: 'owned-model', connection_id: 'owned-key', model_id: 'llm' }], error: null });
  mocks.fetch.mockResolvedValue(Response.json({ health: { 'owned-model': { status: 'rate_limited', retryAt: 61000 } } }));
  vi.stubGlobal('fetch', mocks.fetch);
});
describe('provider health ownership', () => {
  it('requires sign-in and deployment access before looking up telemetry', async () => {
    mocks.owner = ''; expect((await GET(request())).status).toBe(401);
    mocks.denied = Response.json({}, { status: 403 }); expect((await GET(request())).status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.eq).not.toHaveBeenCalled();
  });
  it('uses the authenticated owner and only their saved model records', async () => {
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'owner');
    expect(mocks.inside).toHaveBeenCalledWith('connection_id', ['owned-key']);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe('http://backend/api/ai/health');
    expect(JSON.parse(init.body)).toEqual({ userId: 'owner', models: [{ id: 'owned-model', connectionId: 'owned-key', modelId: 'llm' }] });
    expect(init.headers.get('x-void-internal-key')).toBe('internal');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('does not label a provider failed when the telemetry service is unavailable', async () => {
    mocks.fetch.mockRejectedValue(new Error('Offline'));
    const response = await GET(request()); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Health service unavailable.' });
  });
});
