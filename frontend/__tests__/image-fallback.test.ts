import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  admin: true, userId: 'user-1' as string | null, connections: [] as Record<string, unknown>[],
  models: [] as Record<string, unknown>[], fallback: true,
  managed: vi.fn(), store: vi.fn(), openKey: vi.fn(() => 'test-user-key'),
}));
vi.mock('@/lib/deployment-access', () => ({ requireDeploymentAccess: () => null }));
vi.mock('@/lib/reliability', () => ({ fetchWithRetry: mocks.managed }));
vi.mock('@/lib/generated-image-store', () => ({ readGeneratedImage: vi.fn(), storeGeneratedImage: mocks.store }));
vi.mock('@/lib/ai/server', () => ({
  authenticatedUser: async () => mocks.userId, isAdminUser: async () => mocks.admin, openKey: mocks.openKey,
  serviceDb: () => ({ from: (table: string) => {
    const result = { data: table === 'provider_connections' ? mocks.connections : table === 'provider_models' ? mocks.models
      : table === 'routing_preferences' ? { fallback_enabled: mocks.fallback, image_model_id: 'model-1' } : null, error: null };
    const query = { select: () => query, eq: () => query, in: () => query, maybeSingle: async () => result, insert: async () => result,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  } }),
}));
import { POST } from '@/app/api/generate-image/route';

const request = () => new Request('http://localhost/api/generate-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Create a poster on lunar exploration', size: '1024x1536', model: 'Auto' }) });

describe('admin managed poster fallback', () => {
  beforeEach(async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
    vi.stubEnv('CLOUDFLARE_SDXL_URL', 'https://managed.example.test/image');
    vi.stubEnv('CLOUDFLARE_SDXL_KEY', 'test-managed-key');
    vi.stubEnv('GROQ_API_KEY', ''); vi.stubEnv('VOID_ALLOW_FREE_IMAGE', 'false');
    mocks.admin = true; mocks.userId = 'user-1'; mocks.connections = []; mocks.models = []; mocks.fallback = true;
    const bytes = await sharp(randomBytes(256 * 256 * 3), { raw: { width: 256, height: 256, channels: 3 } }).jpeg().toBuffer();
    mocks.managed.mockResolvedValue(new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg' } }));
    mocks.store.mockResolvedValue({ id: '12345678-1234-1234-1234-123456789012.jpg' });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it('generates through existing Cloudflare credentials for an admin without any BYOK', async () => {
    const response = await POST(request()); const data = await response.json();
    expect(response.status).toBe(200); expect(data.modelUsed).toBe('Cloudflare Image');
    expect(data.notice).toMatch(/No image generation key is connected.*backup.*preferred image generation key/);
    expect(mocks.openKey).not.toHaveBeenCalled(); expect(mocks.managed).toHaveBeenCalledTimes(1);
    const options = mocks.managed.mock.calls[0][1];
    expect(JSON.parse(options.body).prompt).toContain('absolutely no text');
    const metadata = await sharp(mocks.store.mock.calls[0][0]).metadata();
    expect([metadata.width, metadata.height]).toEqual([1024, 1536]);
    expect(JSON.stringify(data)).not.toContain('test-managed-key');
  });
  it('tries connected user images before falling back after provider rejection', async () => {
    mocks.connections = [{ id: 'connection-1', capability_usage: {} }];
    mocks.models = [{ id: 'model-1', connection_id: 'connection-1', provider_id: 'openai', model_id: 'image-test', capabilities: { imageGeneration: true } }];
    const userFetch = vi.fn().mockResolvedValue(new Response('', { status: 429 })); vi.stubGlobal('fetch', userFetch);
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect((await result.json()).notice).toMatch(/connected image provider is unavailable/);
    expect(userFetch).toHaveBeenCalledTimes(1); expect(mocks.managed).toHaveBeenCalledTimes(1);
  });
  it('does not expose managed images to ordinary users or signed-out callers', async () => {
    mocks.admin = false;
    vi.stubEnv('VOID_ALLOW_FREE_IMAGE', 'true'); vi.stubEnv('POLLINATIONS_API_KEY', 'test-free-key');
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/No image generation API key has been connected/);
    expect(mocks.managed).not.toHaveBeenCalled();
    mocks.userId = null;
    expect((await POST(request())).status).toBe(401); expect(mocks.managed).not.toHaveBeenCalled();
  });
  it('honors disabled fallback', async () => {
    mocks.fallback = false;
    expect((await POST(request())).status).toBe(422); expect(mocks.managed).not.toHaveBeenCalled();
  });
});
