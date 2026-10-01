import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => ({
  owner: 'owner', current: {} as Row, models: {} as Record<string, Row>, connections: {} as Record<string, Row>,
  upsert: vi.fn(), modelRead: vi.fn(),
}));
vi.mock('@/lib/deployment-access', () => ({ requireDeploymentAccess: () => null }));
vi.mock('@/lib/ai/server', () => ({
  authenticatedUser: async () => mocks.owner,
  serviceDb: () => ({ from: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const result = () => {
      const id = filters.find(([field]) => field === 'id')?.[1] as string;
      if (table === 'provider_models') mocks.modelRead(id);
      const row = table === 'routing_preferences' ? mocks.current : table === 'provider_models' ? mocks.models[id] : mocks.connections[id];
      return { data: row && filters.every(([field, value]) => row[field] === value) ? row : null, error: null };
    };
    const query = { select: () => query, eq: (field: string, value: unknown) => { filters.push([field, value]); return query; }, single: async () => result(), maybeSingle: async () => result(), upsert: mocks.upsert };
    return query;
  } }),
}));
import { PATCH } from '@/app/api/ai/preferences/route';

const request = (body: unknown) => new Request('http://localhost/api/ai/preferences', { method: 'PATCH', body: JSON.stringify(body) });
beforeEach(() => {
  mocks.owner = 'owner';
  mocks.current = { user_id: 'owner', default_mode: 'MANUAL', preferred_model_id: 'disabled-chat', image_model_id: null, voice_connection_id: 'old-voice', fallback_enabled: false };
  mocks.models = {
    'disabled-chat': { id: 'disabled-chat', connection_id: 'openai-key', enabled: false, capabilities: { text: true, streaming: true } },
    'chat': { id: 'chat', connection_id: 'openai-key', enabled: true, capabilities: { text: true, streaming: true } },
    'image-1.5': { id: 'image-1.5', model_id: 'gpt-image-1.5', connection_id: 'openai-key', enabled: true, capabilities: { text: false, streaming: false, imageGeneration: true } },
  };
  mocks.connections = { 'openai-key': { id: 'openai-key', user_id: 'owner', provider_id: 'openai', enabled: true, status: 'connected', capability_usage: {} } };
  mocks.upsert.mockImplementation(async (row: Row) => { mocks.current = { ...mocks.current, ...row }; return { error: null }; });
});

describe('independent provider preferences', () => {
  it('saves GPT Image 1.5 despite a disabled chat preference in Manual mode', async () => {
    const response = await PATCH(request({ imageModelId: 'image-1.5' }));
    expect(response.status).toBe(200);
    expect(mocks.modelRead.mock.calls).toEqual([['image-1.5']]);
    expect(mocks.current).toMatchObject({ default_mode: 'MANUAL', preferred_model_id: 'disabled-chat', image_model_id: 'image-1.5', voice_connection_id: 'old-voice', fallback_enabled: false });
    expect(mocks.upsert.mock.calls[0][0]).toEqual({ user_id: 'owner', image_model_id: 'image-1.5', updated_at: expect.any(String) });
  });
  it('returns to Automatic image routing without touching chat or voice preferences', async () => {
    mocks.current.image_model_id = 'image-1.5';
    expect((await PATCH(request({ imageModelId: null }))).status).toBe(200);
    expect(mocks.modelRead).not.toHaveBeenCalled();
    expect(mocks.upsert.mock.calls[0][0]).toEqual({ user_id: 'owner', image_model_id: null, updated_at: expect.any(String) });
  });
  it('still rejects disabled chat assignments and image models selected as chat models', async () => {
    expect((await PATCH(request({ mode: 'MANUAL' }))).status).toBe(400);
    expect((await PATCH(request({ mode: 'AUTO', modelId: 'image-1.5' }))).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('requires image capability, ownership, an enabled connection and image usage', async () => {
    expect((await PATCH(request({ imageModelId: 'chat' }))).status).toBe(400);
    for (const change of [{ user_id: 'someone-else' }, { enabled: false }, { status: 'invalid' }, { capability_usage: { image: false } }]) {
      const original = mocks.connections['openai-key']; mocks.connections['openai-key'] = { ...original, ...change };
      expect((await PATCH(request({ imageModelId: 'image-1.5' }))).status).toBe(400);
      mocks.connections['openai-key'] = original;
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('permits valid Manual chat changes independently of stale image and voice preferences', async () => {
    mocks.current.image_model_id = 'old-image';
    expect((await PATCH(request({ mode: 'MANUAL', modelId: 'chat' }))).status).toBe(200);
    expect(mocks.current).toMatchObject({ preferred_model_id: 'chat', image_model_id: 'old-image', voice_connection_id: 'old-voice' });
  });
  it('allows Auto mode to replace a stale Manual mode without resubmitting its model', async () => {
    expect((await PATCH(request({ mode: 'AUTO' }))).status).toBe(200);
    expect(mocks.modelRead).not.toHaveBeenCalled();
    expect(mocks.upsert.mock.calls[0][0]).toEqual({ user_id: 'owner', default_mode: 'AUTO', updated_at: expect.any(String) });
  });
  it('rejects signed-out callers and malformed preference patches', async () => {
    for (const body of [null, [], {}, { mode: 'invalid' }, { imageModelId: 123 }, { fallbackEnabled: 'yes' }]) expect((await PATCH(request(body))).status).toBe(400);
    mocks.owner = ''; expect((await PATCH(request({ imageModelId: 'image-1.5' }))).status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
