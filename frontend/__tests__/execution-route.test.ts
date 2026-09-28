import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultExecutionConfig, EXECUTION_METADATA_KEY } from '@void/shared/execution-config.mjs';
const primary = '11111111-1111-4111-8111-111111111111', foreign = '99999999-9999-4999-8999-999999999999';
const mocks = vi.hoisted(() => ({ owner: 'owner', update: vi.fn(), metadata: { name: 'Preserved profile' } as Record<string, unknown> }));
vi.mock('@/lib/deployment-access', () => ({ requireDeploymentAccess: () => null }));
vi.mock('@/lib/ai/server', () => ({ authenticatedUser: async () => mocks.owner, serviceDb: () => ({ auth: { admin: { updateUserById: mocks.update } }, from: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { preferred_model_id: '11111111-1111-4111-8111-111111111111' } }) }; return query; } }) }));
vi.mock('@/lib/ai/execution-settings', () => ({ connectedExecutionModels: async () => [{ id: '11111111-1111-4111-8111-111111111111' }], executionMetadata: async () => mocks.metadata }));
import { GET, PATCH } from '@/app/api/ai/execution/route';
const request = (config: unknown) => new Request('http://localhost/api/ai/execution', { method: 'PATCH', body: JSON.stringify({ config }) });
beforeEach(() => { mocks.owner = 'owner'; mocks.metadata = { name: 'Preserved profile' }; mocks.update.mockReset().mockResolvedValue({ error: null }); });
describe('execution settings ownership', () => {
  it('requires a primary when connected models are available', async () => {
    expect((await PATCH(request(defaultExecutionConfig()))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('requires authentication for read and write', async () => {
    mocks.owner = ''; expect((await GET(new Request('http://localhost/api/ai/execution'))).status).toBe(401);
    expect((await PATCH(request(defaultExecutionConfig(primary)))).status).toBe(401);
  });
  it('rejects models from other owners before any write', async () => {
    expect((await PATCH(request({ ...defaultExecutionConfig(primary), fallbackModelIds: [foreign] }))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('preserves unrelated profile metadata while saving the workflow', async () => {
    const config = defaultExecutionConfig(primary); expect((await PATCH(request(config))).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith('owner', { user_metadata: { name: 'Preserved profile', [EXECUTION_METADATA_KEY]: config } });
  });
  it('reports save errors instead of claiming success', async () => {
    mocks.update.mockResolvedValue({ error: new Error('storage unavailable') });
    expect((await PATCH(request(defaultExecutionConfig(primary)))).status).toBe(503);
  });
});
