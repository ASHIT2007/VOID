import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ owner: 'owner-a', denied: null as Response | null, eq: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), remove: vi.fn(), open: vi.fn(), seal: vi.fn(), fetch: vi.fn(), connection: null as Record<string, unknown> | null, result: { data: [] as unknown, error: null as { code: string } | null } }));
vi.mock('@/lib/deployment-access', () => ({ requireDeploymentAccess: () => mocks.denied }));
vi.mock('@/lib/ai/server', () => ({ authenticatedUser: async () => mocks.owner, openKey: mocks.open, sealKey: mocks.seal,
  serviceDb: () => ({ from: () => {
    const query = { select: (fields: string) => { mocks.select(fields); return query; }, eq: (...args: unknown[]) => { mocks.eq(...args); return query; }, order: () => query,
      insert: (value: unknown) => { mocks.insert(value); return query; }, update: (value: unknown) => { mocks.update(value); return query; }, delete: () => { mocks.remove(); return query; },
      maybeSingle: async () => ({ data: mocks.connection, error: mocks.result.error }), single: async () => mocks.result,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ ...mocks.result, count: 0 }).then(resolve) };
    return query;
  } }) }));
import { GET, POST, PATCH, DELETE } from '@/app/api/ai/search/route';
const id = '11111111-1111-4111-8111-111111111111';
const request = (method: string, body?: unknown) => new Request(`http://localhost/api/ai/search?id=${id}&userId=foreign-owner`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => {
  mocks.owner = 'owner-a'; mocks.denied = null; mocks.connection = null; mocks.result = { data: [], error: null };
  mocks.open.mockReturnValue('owned-key'); mocks.seal.mockReturnValue({ encrypted_api_key: 'ciphertext', key_iv: 'iv', key_auth_tag: 'tag', key_fingerprint: 'hash', masked_key: 'masked' });
  mocks.fetch.mockImplementation(async () => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', mocks.fetch);
});
describe('per-user search key storage', () => {
  it('denies every action without authentication or deployment access', async () => {
    mocks.owner = '';
    for (const handler of [GET, POST, PATCH, DELETE]) expect((await handler(request('POST'))).status).toBe(401);
    mocks.denied = Response.json({}, { status: 403 }); expect((await GET(request('GET'))).status).toBe(403);
    expect(mocks.select).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('lists only safe fields scoped to the authenticated user', async () => {
    const response = await GET(request('GET'));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'owner-a');
    expect(mocks.select.mock.calls[0][0]).not.toMatch(/encrypted|key_iv|key_auth_tag|fingerprint/);
  });
  it('rejects access to another user’s connection before decrypting or testing', async () => {
    expect((await PATCH(request('PATCH', { id, action: 'test', userId: 'foreign-owner' }))).status).toBe(404);
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'owner-a');
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('verifies and encrypts a user key and never saves the submitted owner or plaintext', async () => {
    expect((await POST(request('POST', { providerId: 'tavily', apiKey: 'user-search-key', userId: 'foreign-owner' }))).status).toBe(201);
    expect(mocks.seal).toHaveBeenCalledWith('user-search-key');
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'owner-a', encrypted_api_key: 'ciphertext' }));
    expect(JSON.stringify(mocks.insert.mock.calls[0])).not.toContain('user-search-key');
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer user-search-key');
  });
  it('sanitizes provider errors instead of returning their response body', async () => {
    mocks.fetch.mockResolvedValue(new Response('secret-provider-response', { status: 429 }));
    const response = await POST(request('POST', { providerId: 'brave', apiKey: 'user-key' }));
    expect(response.status).toBe(400); expect(await response.text()).not.toContain('secret-provider-response');
    expect(mocks.seal).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('scopes disconnecting a key to its authenticated owner', async () => {
    expect((await DELETE(request('DELETE'))).status).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith('id', id); expect(mocks.eq).toHaveBeenCalledWith('user_id', 'owner-a');
  });
});
