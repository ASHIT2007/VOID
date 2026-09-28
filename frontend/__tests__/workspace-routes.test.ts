import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ owner: 'alice' as string | null, denied: false, fetch: vi.fn() }));
vi.mock('@/lib/deployment-access', () => ({ requireDeploymentAccess: () => mocks.denied ? new Response('Denied', { status: 401 }) : null }));
vi.mock('@/lib/ai/server', () => ({ authenticatedUser: async () => mocks.owner, loadByokContext: async () => ({ userId: mocks.owner, models: [] }) }));
vi.mock('@/lib/backend', () => ({ backendUrl: (path: string) => `http://backend${path}`, backendHeaders: (headers: object) => headers }));
import { POST as result } from '@/app/api/client-tool/route';
import { POST as read } from '@/app/api/file-read/route';
import { GET as sandbox } from '@/app/api/sandbox/route';
const request = (path: string, body: unknown) => new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { mocks.owner = 'alice'; mocks.denied = false; mocks.fetch.mockReset(); vi.stubGlobal('fetch', mocks.fetch); });
describe('workspace perimeter', () => {
  it('requires authentication and uses the verified owner, not a supplied identity', async () => {
    mocks.owner = null; expect((await result(request('/api/client-tool', {}))).status).toBe(401); expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.owner = 'alice'; mocks.fetch.mockResolvedValueOnce(Response.json({ ok: true }));
    expect((await result(request('/api/client-tool', { userId: 'bob', requestId: 'request', token: 'a'.repeat(64), content: 'Approved output' }))).status).toBe(200);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).userId).toBe('alice');
  });
  it('rejects malformed or oversized workspace responses and file data before backend work', async () => {
    expect((await result(new Request('http://localhost/api/client-tool', { method: 'POST', body: '{broken' }))).status).toBe(400);
    expect((await result(request('/api/client-tool', { token: 'x', content: '' }))).status).toBe(400);
    expect((await read(request('/api/file-read', { attachment: { base64: 'a'.repeat(20000001) } }))).status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('serves a restricted isolated document with the browser-visible asset origin', async () => {
    const response = await sandbox(new Request('http://0.0.0.0:3000/api/sandbox', { headers: { host: '0.0.0.0:3000', 'x-forwarded-host': 'localhost:3000' } }));
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('content-security-policy')).toContain('http://localhost:3000/sandbox-runtime/');
    expect(await response.text()).not.toContain('http://0.0.0.0');
    mocks.denied = true; expect((await sandbox(new Request('http://localhost/api/sandbox'))).status).toBe(401);
  });
});
