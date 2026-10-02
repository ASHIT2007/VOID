import { createHash } from 'node:crypto';
import type { Platform } from '@void/shared/types.js';
import { decrypt } from '../lib/crypto.js';
import { resolveProvider } from '../providers/index.js';
import { byokModelOnCooldown, NON_CHAT_MODEL_PATTERN, type ByokModel } from './byok-context.js';
import { getByokRuntimeHealth, recordByokOutcome, type RuntimeHealth } from './byok-health.js';

const pending = new Map<string, Promise<RuntimeHealth>>();
const credentials = new Map<string, Promise<unknown>>();
const fingerprints = new Map<string, string>();

/** A tiny, cached completion verifies access to this exact model. Never falls back. */
export async function checkByokReadiness(userId: string, model: ByokModel): Promise<RuntimeHealth> {
  const identity = `${userId}:${model.connectionId}:${model.modelId}`;
  const fingerprint = createHash('sha256').update(`${model.encryptedKey}:${model.iv}:${model.authTag}:${model.baseUrl || ''}`).digest('hex');
  const requestKey = `${identity}:${fingerprint}`;
  const existing = pending.get(requestKey);
  if (existing) return existing;
  const previous = getByokRuntimeHealth(userId, model.connectionId, model.modelId);
  const sameCredential = fingerprints.get(identity) === fingerprint;
  if (sameCredential && (previous.status === 'healthy' && previous.checkedAt && Date.now() - previous.checkedAt < 60_000
    || previous.retryAt && previous.retryAt > Date.now())) return previous;

  const lane = `${userId}:${model.connectionId}`;
  const task = (credentials.get(lane) || Promise.resolve()).catch(() => {}).then(async () => {
    const started = Date.now();
    try {
      if (!model.enabled || !model.capabilities.text || !model.capabilities.streaming || NON_CHAT_MODEL_PATTERN.test(model.modelId)) throw new Error('Model is unavailable for chat');
      if (byokModelOnCooldown(userId, model)) throw Object.assign(new Error('Rate limited'), { status: 429 });
      const provider = resolveProvider(model.providerId as Platform, model.baseUrl, true);
      if (!provider) throw new Error('Provider is unavailable');
      const apiKey = decrypt(model.encryptedKey, model.iv, model.authTag);
      let content = '';
      for await (const chunk of provider.streamChatCompletion(apiKey, [{ role: 'user', content: 'Reply OK.' }], model.modelId,
        { max_tokens: 64, reasoning_effort: 'low', signal: AbortSignal.timeout(8000) })) {
        const text = chunk.choices?.[0]?.delta?.content;
        if (typeof text === 'string') content += text;
      }
      if (!content.trim()) throw new Error('Provider returned an empty response');
      recordByokOutcome(userId, model.providerId, model.modelId, true, Date.now() - started, { connectionId: model.connectionId, source: 'probe', startedAt: started });
    } catch (error) {
      recordByokOutcome(userId, model.providerId, model.modelId, false, Date.now() - started, { connectionId: model.connectionId, error });
    }
    fingerprints.set(identity, fingerprint);
    if (fingerprints.size > 10_000) fingerprints.delete(fingerprints.keys().next().value!);
    return getByokRuntimeHealth(userId, model.connectionId, model.modelId);
  });
  pending.set(requestKey, task); credentials.set(lane, task);
  try { return await task; }
  finally { pending.delete(requestKey); if (credentials.get(lane) === task) credentials.delete(lane); }
}
