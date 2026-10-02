import { Router } from 'express';
import { z } from 'zod';
import { byokConnectionId, byokRouteOnCooldown, withByokContext, routeByokRequest, type ByokContext } from '../ai/byok-context.js';
import type { ChatMessage } from '@void/shared/types.js';
import { getByokRuntimeHealth, recordByokOutcome } from '../ai/byok-health.js';
import { checkByokReadiness } from '../ai/byok-readiness.js';
import { searchCredentialSchema } from '../ai/search-credentials.js';

export const aiGenerateRouter = Router();

// This router is protected by the internal service key. The frontend supplies
// only the authenticated owner's model records, never client-provided IDs.
aiGenerateRouter.post('/health', (req, res) => {
  const result = z.object({ userId: z.string().uuid(), models: z.array(z.object({
    id: z.string().uuid(), connectionId: z.string().uuid(), modelId: z.string().max(256), providerId: z.string().max(80).optional(),
  })).max(2000) }).safeParse(req.body);
  if (!result.success) { res.status(400).json({ error: 'Invalid health request.' }); return; }
  const { userId, models } = result.data;
  res.set('Cache-Control', 'no-store').json({ health: Object.fromEntries(models.map(model => {
    const health = getByokRuntimeHealth(userId, model.connectionId, model.modelId);
    return [model.id, model.providerId && byokRouteOnCooldown(userId, model.connectionId, model.providerId, model.modelId)
      ? { ...health, status: 'rate_limited', checkedAt: Date.now() } : health];
  })) });
});

const schema = z.object({
  byok: z.object({
    userId: z.string().uuid(), mode: z.enum(['AUTO', 'FAST', 'DEEP', 'CREATIVE', 'EFFICIENT', 'MANUAL']),
    taskType: z.enum(['general', 'coding', 'reasoning', 'creative']).optional(),
    manualModelId: z.string().uuid().optional(),
    preferredModelId: z.string().uuid().optional(),
    fallbackEnabled: z.boolean().optional(),
    searchCredentials: z.array(searchCredentialSchema).max(20).optional(),
    execution: z.object({ version: z.literal(1), primaryModelId: z.string().uuid().nullable(),
      roles: z.array(z.object({ id: z.string().max(64), name: z.string().max(60), kind: z.enum(['researcher', 'analyst', 'fact_checker', 'answer_writer', 'custom']), modelId: z.string().uuid(), instruction: z.string().max(600) })).max(6),
      fallbackModelIds: z.array(z.string().uuid()).max(8) }).optional(),
    models: z.array(z.object({ id: z.string().uuid(), connectionId: z.string().uuid(), providerId: z.string(), modelId: z.string(),
      displayName: z.string(), baseUrl: z.string().nullable().optional(), encryptedKey: z.string(), iv: z.string(), authTag: z.string(),
      capabilities: z.object({ text: z.boolean(), vision: z.boolean(), toolCalling: z.boolean(), streaming: z.boolean(),
        reasoning: z.boolean().optional(), structuredOutput: z.boolean().optional(), imageGeneration: z.boolean().optional() }),
      contextWindow: z.number().nullable().optional(), enabled: z.boolean(), toolsEnabled: z.boolean().optional(), priority: z.number().optional() })).max(200),
  }),
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(20000) })).min(1).max(20),
  maxOutputTokens: z.number().int().min(1).max(8000).default(2000),
  requireStructured: z.boolean().default(false),
});

aiGenerateRouter.post('/health/check', async (req, res) => {
  const parsed = z.object({ byok: schema.shape.byok, modelIds: z.array(z.string().uuid()).min(1).max(15) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid readiness request.' }); return; }
  const { byok, modelIds } = parsed.data;
  const models = [...new Set(modelIds)].map(id => byok.models.find(model => model.id === id));
  if (models.some(model => !model)) { res.status(400).json({ error: 'Model unavailable.' }); return; }
  const entries = await Promise.all(models.map(async model => [model!.id, await checkByokReadiness(byok.userId, model!)] as const));
  res.set('Cache-Control', 'no-store').json({ health: Object.fromEntries(entries) });
});

aiGenerateRouter.post('/generate', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid generation request.' }); return; }
  const { byok, messages, maxOutputTokens, requireStructured } = parsed.data;
  try {
    const eligible = { ...byok, models: byok.models.filter(model => !requireStructured || model.capabilities.structuredOutput) };
    const result = await withByokContext(eligible as ByokContext, async () => {
      const skip = new Set<string>();
      for (let attempt = 0; attempt < eligible.models.length; attempt++) {
        const route = routeByokRequest(eligible as ByokContext, Math.ceil(JSON.stringify(messages).length / 4) + maxOutputTokens, skip);
        const startedAt = Date.now();
        try {
          const completion = await route.provider.chatCompletion(route.apiKey, messages as ChatMessage[], route.modelId,
            { max_tokens: maxOutputTokens, signal: AbortSignal.timeout(45_000) });
          const content = completion.choices[0]?.message?.content;
          if (typeof content !== 'string' || !content.trim()) throw new Error('Provider returned an empty response');
          recordByokOutcome(byok.userId, route.platform, route.modelId, true, Date.now() - startedAt, { connectionId: byokConnectionId(byok as ByokContext, route.keyId) });
          return { text: content, providerId: route.platform, modelId: route.modelId, usage: completion.usage, fallbackCount: attempt };
        } catch (error) {
          recordByokOutcome(byok.userId, route.platform, route.modelId, false, Date.now() - startedAt, { connectionId: byokConnectionId(byok as ByokContext, route.keyId), error });
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (!/\b(?:401|402|403|408|429|50[0-9])\b|timeout|timed out|fetch failed|connection|empty response/.test(message)) throw error;
          skip.add(`${route.platform}:${route.modelId}:${route.keyId}`);
          if (/\b(?:401|402|403)\b/.test(message)) skip.add(`${route.platform}:*:${route.keyId}`);
        }
      }
      throw new Error('No connected model completed the request');
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    res.status(/no compatible|no connected/i.test(message) ? 422 : 502)
      .json({ error: /\b401\b|\b403\b/.test(message) ? 'Provider authentication failed.' : 'A connected model could not complete this request.' });
  }
});
