import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { initDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { getProvider } from '../../providers/index.js';
import { aiGenerateRouter } from '../../routes/ai-generate.js';

const USER = '11111111-1111-4111-8111-111111111111';
function candidate(id: string, providerId: 'openai' | 'groq', key: string, priority: number) {
  const encrypted = encrypt(key);
  return { id, connectionId: id, providerId, modelId: `model-${providerId}`, displayName: providerId,
    encryptedKey: encrypted.encrypted, iv: encrypted.iv, authTag: encrypted.authTag,
    enabled: true, priority, capabilities: { text: true, vision: false, toolCalling: true, streaming: true, structuredOutput: true } };
}

async function post(body: unknown) {
  const app = express(); app.use(express.json()); app.use('/api/ai', aiGenerateRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server unavailable');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ai/generate`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally { server.close(); }
}

describe('normalized BYOK generation API', () => {
  beforeAll(() => { process.env.ENCRYPTION_KEY = 'e'.repeat(64); initDb(':memory:'); });
  afterEach(() => vi.restoreAllMocks());

  it('falls back after a transient 429 and returns normalized usage', async () => {
    const openai = getProvider('openai')!;
    const groq = getProvider('groq')!;
    vi.spyOn(openai, 'chatCompletion').mockRejectedValue(new Error('OpenAI API error 429'));
    vi.spyOn(groq, 'chatCompletion').mockResolvedValue({ id: 'answer', object: 'chat.completion', created: 1, model: 'model-groq',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } });
    const body = { byok: { userId: USER, mode: 'AUTO', models: [
      candidate('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'openai', 'first-secret', 10),
      candidate('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'groq', 'second-secret', 0),
    ] }, messages: [{ role: 'user', content: 'Hi' }] };
    const result = await post(body);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ text: 'Hello', providerId: 'groq', fallbackCount: 1, usage: { total_tokens: 4 } });
    expect(JSON.stringify(result.body)).not.toContain('secret');
  });

  it('tries another connected credential after authentication failure', async () => {
    vi.spyOn(getProvider('openai')!, 'chatCompletion').mockRejectedValue(new Error('OpenAI API error 401'));
    const groq = vi.spyOn(getProvider('groq')!, 'chatCompletion').mockResolvedValue({ id: 'answer', object: 'chat.completion', created: 1, model: 'model-groq',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Recovered' }, finish_reason: 'stop' }] });
    const result = await post({ byok: { userId: USER, mode: 'AUTO', models: [
      candidate('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'openai', 'private-key', 10),
      candidate('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'groq', 'other-key', 0),
    ] }, messages: [{ role: 'user', content: 'Hi' }] });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ text: 'Recovered', providerId: 'groq', fallbackCount: 1 });
    expect(groq).toHaveBeenCalledOnce();
  });

  it('honors disabled fallback', async () => {
    vi.spyOn(getProvider('openai')!, 'chatCompletion').mockRejectedValue(new Error('OpenAI API error 429'));
    const groq = vi.spyOn(getProvider('groq')!, 'chatCompletion');
    const result = await post({ byok: { userId: USER, mode: 'AUTO', fallbackEnabled: false, models: [
      candidate('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'openai', 'private-key', 10),
      candidate('ffffffff-ffff-4fff-8fff-ffffffffffff', 'groq', 'other-key', 0),
    ] }, messages: [{ role: 'user', content: 'Hi' }] });
    expect(result.status).toBe(502);
    expect(groq).not.toHaveBeenCalled();
  });
});
