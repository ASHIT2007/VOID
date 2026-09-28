import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ admin: false, models: [] as Record<string, unknown>[], connections: [] as Record<string, unknown>[] }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }), admin: { getUserById: async () => ({ data: { user: { app_metadata: { role: mocks.admin ? 'admin' : 'user' } } }, error: null }) } },
  from: (table: string) => {
    const result = { data: table === 'provider_connections' ? mocks.connections : table === 'provider_models' ? mocks.models : null, error: null };
    const query = { select: () => query, eq: () => query, in: () => query, maybeSingle: async () => result, then: (resolve: (x: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  },
}) }));
vi.mock('@/lib/deployment-access', () => ({ requireDeploymentAccess: () => null }));
import { loadByokContext } from '@/lib/ai/server';
import { POST } from '@/app/api/chat/route';
beforeEach(() => {
  mocks.admin = false; mocks.models = []; mocks.connections = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
  vi.stubEnv('GROQ_API_KEY', 'test-managed'); vi.stubEnv('ENCRYPTION_KEY', '0'.repeat(64)); vi.stubEnv('VOID_ALLOW_FREE_CHAT', 'true');
});
afterEach(() => { vi.unstubAllEnvs(); });
describe('missing chat keys', () => {
  it('does not silently lend a managed key to ordinary users without a connection', async () => {
    expect((await loadByokContext('user-a')).models).toHaveLength(0);
    const response = await POST(new NextRequest('http://localhost/api/chat', { method: 'POST', headers: { 'x-void-user-token': 'token' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }) }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: expect.stringContaining('No API key has been connected'), code: 'chat_key_missing' });
  });
  it('retains the admin managed chat model', async () => {
    mocks.admin = true;
    expect((await loadByokContext('user-a')).models).toContainEqual(expect.objectContaining({ displayName: 'VOID managed' }));
  });
  it('never lends the admin environment key to a voice brain', async () => {
    mocks.admin = true;
    expect((await loadByokContext('user-a', { includeManaged: false })).models).toHaveLength(0);
    const response = await POST(new NextRequest('http://localhost/api/chat', { method: 'POST', headers: { 'x-void-user-token': 'token' }, body: JSON.stringify({ isVoice: true, messages: [{ role: 'user', content: 'Hello' }] }) }));
    expect(response.status).toBe(422);
  });
  it('retains connected user models and their capability limits', async () => {
    mocks.connections = [{ id: 'connection-a', capability_usage: { chat: true, tools: false } }];
    mocks.models = [{ id: 'model-a', connection_id: 'connection-a', enabled: true, capabilities: { text: true, toolCalling: true } }];
    expect((await loadByokContext('user-a')).models).toEqual([expect.objectContaining({ id: 'model-a', toolsEnabled: false, capabilities: { text: true, toolCalling: false } })]);
  });
});
