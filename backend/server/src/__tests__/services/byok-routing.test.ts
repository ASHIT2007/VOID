import { beforeAll, describe, expect, it } from 'vitest';
import { initDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { routeRequest } from '../../services/router.js';
import { availableChatRouteCount, withByokContext, type ByokContext, type ByokModel } from '../../ai/byok-context.js';
import { defaultExecutionConfig } from '@void/shared/execution-config.mjs';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function model(id: string, providerId: string, key: string, capability: Partial<ByokModel['capabilities']> = {}): ByokModel {
  const encrypted = encrypt(key);
  return { id, connectionId: id, providerId, modelId: `model-${id.slice(0, 4)}`, displayName: providerId,
    encryptedKey: encrypted.encrypted, iv: encrypted.iv, authTag: encrypted.authTag, enabled: true,
    capabilities: { text: true, vision: false, toolCalling: true, streaming: true, ...capability } };
}

function context(userId: string, models: ByokModel[], mode: ByokContext['mode'] = 'AUTO'): ByokContext {
  return { userId, mode, models };
}

describe('BYOK routing boundary', () => {
  beforeAll(() => { process.env.ENCRYPTION_KEY = 'f'.repeat(64); initDb(':memory:'); });
  it('honors only the saved routing sequence, including an explicitly added same-key fallback', async () => {
    const first = model('50505050-5050-4050-8050-505050505050', 'groq', 'shared');
    const backup = { ...first, id: '51515151-5151-4151-8151-515151515151', modelId: 'explicit-backup', priority: 100 };
    const unlisted = model('52525252-5252-4252-8252-525252525252', 'openai', 'unlisted'); unlisted.priority = 1000;
    const execution = { ...defaultExecutionConfig(first.id), fallbackModelIds: [backup.id] };
    await withByokContext({ ...context(USER_A, [unlisted, backup, first]), execution, fallbackEnabled: true }, async () => {
      const selected = routeRequest(100); expect(selected.modelId).toBe(first.modelId);
      const skipped = new Set([`${selected.platform}:${selected.modelId}:${selected.keyId}`]);
      expect(routeRequest(100, skipped).modelId).toBe(backup.modelId);
      skipped.add(`${backup.providerId}:${backup.modelId}:${selected.keyId}`);
      expect(() => routeRequest(100, skipped)).toThrow(/compatible/);
    });
  });
  it('does not invent fallback models from the discovered catalog when only a primary is configured', async () => {
    const first = model('53535353-5353-4353-8353-535353535353', 'groq', 'shared');
    const other = { ...first, id: '54545454-5454-4454-8454-545454545454', modelId: 'catalog-model' };
    await withByokContext({ ...context(USER_A, [first, other]), execution: defaultExecutionConfig(first.id), fallbackEnabled: false }, async () => {
      const selected = routeRequest(100); expect(selected.modelId).toBe(first.modelId);
      expect(() => routeRequest(100, new Set([`${selected.platform}:${selected.modelId}:${selected.keyId}`]))).toThrow(/Fallback is disabled/);
    });
  });

  it('budgets workers by independent credentials and respects manual/no-fallback routing', async () => {
    const first = model('12121212-1212-4212-8212-121212121212', 'groq', 'first');
    const sameKey = { ...first, id: '13131313-1313-4313-8313-131313131313', modelId: 'backup-model' };
    const second = model('14141414-1414-4414-8414-141414141414', 'openai', 'second');
    expect(await withByokContext(context(USER_A, [first, sameKey]), async () => availableChatRouteCount())).toBe(1);
    expect(await withByokContext(context(USER_A, [first, sameKey, second]), async () => availableChatRouteCount())).toBe(2);
    expect(await withByokContext({ ...context(USER_A, [first, second]), fallbackEnabled: false }, async () => availableChatRouteCount())).toBe(1);
    expect(await withByokContext({ ...context(USER_A, [first, second], 'MANUAL'), manualModelId: second.id }, async () => availableChatRouteCount())).toBe(1);
  });

  it('isolates simultaneous users and decrypts only the selected credential', async () => {
    const a = model('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'openai', 'user-a-secret');
    const b = model('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'groq', 'user-b-secret');
    const [first, second] = await Promise.all([
      withByokContext(context(USER_A, [a]), async () => { await Promise.resolve(); return routeRequest(); }),
      withByokContext(context(USER_B, [b]), async () => { await Promise.resolve(); return routeRequest(); }),
    ]);
    expect(first.apiKey).toBe('user-a-secret');
    expect(second.apiKey).toBe('user-b-secret');
    expect(first.keyId).not.toBe(second.keyId);
  });

  it('filters disabled and incompatible models before choosing a route', async () => {
    const text = model('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'openai', 'text');
    const vision = model('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'google', 'vision', { vision: true });
    expect((await withByokContext(context(USER_A, [text, vision]), async () => routeRequest(100, undefined, undefined, true))).apiKey).toBe('vision');
    vision.enabled = false;
    await expect(withByokContext(context(USER_A, [text, vision]), async () => routeRequest(100, undefined, undefined, true))).rejects.toThrow(/compatible/);
  });

  it('uses one selected model in Manual mode', async () => {
    const first = model('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'openai', 'first');
    const second = model('ffffffff-ffff-4fff-8fff-ffffffffffff', 'groq', 'second');
    const selected = { ...context(USER_A, [first, second], 'MANUAL'), manualModelId: second.id };
    expect((await withByokContext(selected, async () => routeRequest())).apiKey).toBe('second');
    await expect(withByokContext(selected, async () => routeRequest(100, new Set([`groq:${second.modelId}:*`])))).rejects.toThrow(/compatible/);
  });

  it('rejects specialized non-chat utility models like nvidia/ising-calibration-1.5-31b even if enabled with text capability', async () => {
    const calibrator = model('00000000-0000-4000-8000-000000000001', 'custom', 'secret');
    calibrator.baseUrl = 'https://integrate.api.nvidia.com/v1';
    calibrator.modelId = 'nvidia/ising-calibration-1.5-31b';
    const detector = model('00000000-0000-4000-8000-000000000002', 'custom', 'secret');
    detector.baseUrl = 'https://integrate.api.nvidia.com/v1';
    detector.modelId = 'nvidia/ai-synthetic-video-detector';
    const chatModel = model('00000000-0000-4000-8000-000000000003', 'custom', 'secret');
    chatModel.baseUrl = 'https://integrate.api.nvidia.com/v1';
    chatModel.modelId = 'moonshotai/kimi-k3';

    const route = await withByokContext(context(USER_A, [calibrator, detector, chatModel]), async () => routeRequest());
    expect(route.modelId).toBe('moonshotai/kimi-k3');

    // When only non-chat models are provided, routing fails closed
    await expect(withByokContext(context(USER_A, [calibrator, detector]), async () => routeRequest())).rejects.toThrow(/compatible/);
  });
});
