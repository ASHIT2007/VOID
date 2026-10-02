import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ completion: vi.fn(), decrypt: vi.fn(() => 'private-key'), cooldown: vi.fn(() => false) }));
vi.mock('../../providers/index.js', () => ({ resolveProvider: () => ({ streamChatCompletion: async function* (...args: unknown[]) { const response = await mocks.completion(...args); yield { choices: [{ delta: { content: response.choices[0].message.content } }] }; } }) }));
vi.mock('../../lib/crypto.js', () => ({ decrypt: mocks.decrypt }));
vi.mock('../../ai/byok-context.js', () => ({ byokModelOnCooldown: mocks.cooldown, NON_CHAT_MODEL_PATTERN: /embedding/ }));
import { checkByokReadiness } from '../../ai/byok-readiness.js';
import { getByokRuntimeHealth, recordByokOutcome } from '../../ai/byok-health.js';
import type { ByokModel } from '../../ai/byok-context.js';

const model = (id: string, connectionId = 'credential'): ByokModel => ({ id, connectionId, providerId: 'openai', modelId: id, displayName: id,
  encryptedKey: 'ciphertext', iv: 'iv', authTag: 'tag', enabled: true, capabilities: { text: true, streaming: true, vision: false, toolCalling: false } });
const success = { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] };
beforeEach(() => { vi.restoreAllMocks(); mocks.completion.mockReset().mockResolvedValue(success); mocks.cooldown.mockReset().mockReturnValue(false); mocks.decrypt.mockClear(); });
describe('proactive orchestration readiness', () => {
  it('checks the exact assigned model with a bounded tiny completion and caches repeated use', async () => {
    const target = model('repeat');
    const [a, b] = await Promise.all([checkByokReadiness('owner-repeat', target), checkByokReadiness('owner-repeat', target)]);
    expect(a.status).toBe('healthy'); expect(b).toEqual(a);
    await checkByokReadiness('owner-repeat', target);
    expect(mocks.completion).toHaveBeenCalledTimes(1);
    expect(mocks.completion).toHaveBeenCalledWith('private-key', [{ role: 'user', content: 'Reply OK.' }], 'repeat', { max_tokens: 64, reasoning_effort: 'low', signal: expect.any(AbortSignal) });
    await checkByokReadiness('another-owner', target);
    expect(mocks.completion).toHaveBeenCalledTimes(2);
  });
  it('keeps rate limits red through the backoff and verifies actual recovery afterward', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    mocks.completion.mockRejectedValueOnce(Object.assign(new Error('quota exhausted'), { status: 429 }));
    const target = model('recover');
    expect((await checkByokReadiness('owner-recover', target)).status).toBe('rate_limited');
    await checkByokReadiness('owner-recover', target); expect(mocks.completion).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockReturnValue(61_001);
    expect(getByokRuntimeHealth('owner-recover', 'credential', 'recover').status).toBe('rate_limited');
    expect((await checkByokReadiness('owner-recover', target)).status).toBe('healthy');
    expect(mocks.completion).toHaveBeenCalledTimes(2);
  });
  it('does not substitute another model or clear errors just because a probe is cached', async () => {
    const target = model('offline');
    mocks.completion.mockRejectedValueOnce(new Error('Request timed out'));
    expect((await checkByokReadiness('owner-offline', target)).status).toBe('unavailable');
    expect(mocks.completion.mock.calls[0][2]).toBe('offline');
    expect(getByokRuntimeHealth('owner-offline', 'credential', 'different').status).toBe('unknown');
  });
  it('checks replacement credentials immediately, and respects known provider cooldowns', async () => {
    const target = model('replaced');
    await checkByokReadiness('owner-replace', target);
    mocks.completion.mockRejectedValueOnce(new Error('401 invalid key'));
    expect((await checkByokReadiness('owner-replace', { ...target, encryptedKey: 'replacement' })).status).toBe('unavailable');
    mocks.cooldown.mockReturnValue(true);
    expect((await checkByokReadiness('owner-cooldown', model('limited'))).status).toBe('rate_limited');
    expect(mocks.completion).toHaveBeenCalledTimes(2);
  });
  it('serializes shared credentials and flags streams with no answer content', async () => {
    let release!: (value: typeof success) => void;
    mocks.completion.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = checkByokReadiness('owner-sequence', model('first'));
    const second = checkByokReadiness('owner-sequence', model('second'));
    await vi.waitFor(() => expect(mocks.completion).toHaveBeenCalledTimes(1));
    release(success); await Promise.all([first, second]);
    expect(mocks.completion.mock.calls.map(call => call[2])).toEqual(['first', 'second']);
    mocks.completion.mockResolvedValueOnce({ choices: [{ message: { content: null }, finish_reason: 'length' }] });
    expect((await checkByokReadiness('owner-reasoning', model('reasoning'))).status).toBe('unavailable');
  });
  it('uses recent execution failures instead of mistaking cached success for availability', async () => {
    const target = model('live-failure');
    await checkByokReadiness('owner-live', target);
    recordByokOutcome('owner-live', 'openai', target.modelId, false, 10, { connectionId: target.connectionId, error: { status: 429 } });
    expect((await checkByokReadiness('owner-live', target)).status).toBe('rate_limited');
    expect(mocks.completion).toHaveBeenCalledTimes(1);
  });
});
