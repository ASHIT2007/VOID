import { afterEach, describe, expect, it, vi } from 'vitest';
import { getByokRuntimeHealth, recordByokOutcome } from '../../ai/byok-health.js';

afterEach(() => vi.restoreAllMocks());
describe('orchestration provider health', () => {
  it('shows rate limits on the exact user, credential and model that failed', () => {
    recordByokOutcome('user-a', 'openai', 'shared-model', false, 0, { connectionId: 'key-a', error: new Error('429 rate limit reached') });
    expect(getByokRuntimeHealth('user-a', 'key-a', 'shared-model').status).toBe('rate_limited');
    expect(getByokRuntimeHealth('user-b', 'key-a', 'shared-model').status).toBe('unknown');
    expect(getByokRuntimeHealth('user-a', 'key-b', 'shared-model').status).toBe('unknown');
    expect(getByokRuntimeHealth('user-a', 'key-a', 'another-model').status).toBe('unknown');
  });
  it('marks timeouts and empty responses unavailable and clears on success', () => {
    for (const message of ['Request timed out', 'Provider returned an empty response']) {
      recordByokOutcome('user-c', 'groq', 'model', false, 0, { connectionId: 'key-c', error: new Error(message) });
      expect(getByokRuntimeHealth('user-c', 'key-c', 'model').status).toBe('unavailable');
      recordByokOutcome('user-c', 'groq', 'model', true, 100, { connectionId: 'key-c' });
      expect(getByokRuntimeHealth('user-c', 'key-c', 'model')).toMatchObject({ status: 'healthy', retryAt: null });
    }
  });
  it('keeps a failed model flagged after the retry deadline until recovery is confirmed', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    recordByokOutcome('user-d', 'custom', 'model', false, 0, { connectionId: 'key-d', error: { status: 429 } });
    expect(getByokRuntimeHealth('user-d', 'key-d', 'model')).toMatchObject({ status: 'rate_limited', retryAt: 61_000 });
    vi.mocked(Date.now).mockReturnValue(61_001);
    expect(getByokRuntimeHealth('user-d', 'key-d', 'model').status).toBe('rate_limited');
  });
  it('does not let an overlapping successful probe erase a newer failed turn', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    recordByokOutcome('race-user', 'groq', 'gpt-oss-120b', false, 0, { connectionId: 'race-key', error: { status: 429 } });
    vi.mocked(Date.now).mockReturnValue(2000);
    recordByokOutcome('race-user', 'groq', 'gpt-oss-120b', true, 100, { connectionId: 'race-key', source: 'probe', startedAt: 500 });
    expect(getByokRuntimeHealth('race-user', 'race-key', 'gpt-oss-120b').status).toBe('rate_limited');
    vi.mocked(Date.now).mockReturnValue(62_000);
    recordByokOutcome('race-user', 'groq', 'gpt-oss-120b', true, 100, { connectionId: 'race-key', source: 'probe', startedAt: 61_001 });
    expect(getByokRuntimeHealth('race-user', 'race-key', 'gpt-oss-120b').status).toBe('healthy');
  });

});
