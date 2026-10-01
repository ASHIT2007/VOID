import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { decrypt } from '../lib/crypto.js';
import { resolveProvider } from '../providers/index.js';
import type { RouteResult } from '../services/router.js';
import type { Platform } from '@void/shared/types.js';
import { isOnCooldown } from '../services/ratelimit.js';
import { healthPenalty } from './byok-health.js';
import type { ExecutionConfig } from '@void/shared/execution-config.mjs';

export interface ByokModel {
  id: string;
  connectionId: string;
  providerId: string;
  modelId: string;
  displayName: string;
  baseUrl?: string | null;
  encryptedKey: string;
  iv: string;
  authTag: string;
  capabilities: { text: boolean; vision: boolean; toolCalling: boolean; streaming: boolean; reasoning?: boolean; structuredOutput?: boolean; imageGeneration?: boolean };
  contextWindow?: number | null;
  enabled: boolean;
  toolsEnabled?: boolean;
  priority?: number;
}

export interface ByokContext {
  userId: string;
  mode: 'AUTO' | 'FAST' | 'DEEP' | 'CREATIVE' | 'EFFICIENT' | 'MANUAL';
  taskType?: 'general' | 'coding' | 'reasoning' | 'creative';
  manualModelId?: string;
  preferredModelId?: string;
  fallbackEnabled?: boolean;
  models: ByokModel[];
  execution?: ExecutionConfig;
  assignedModelId?: string;
}

const store = new AsyncLocalStorage<ByokContext>();
export function withByokContext<T>(context: ByokContext, callback: () => Promise<T>): Promise<T> {
  return store.run(context, callback);
}
export function currentByokContext(): ByokContext | undefined { return store.getStore(); }
export function withByokModel<T>(modelId: string, callback: () => Promise<T>): Promise<T> {
  const context = store.getStore();
  return context ? store.run({ ...context, assignedModelId: modelId }, callback) : callback();
}

/** Models sharing one credential share its quota; they are not independent workers. */
export function availableChatRouteCount(): number {
  const context = currentByokContext();
  if (!context) return 4;
  const routes = context.models.filter(model => model.enabled && model.capabilities.text
    && model.capabilities.streaming && !NON_CHAT_MODEL_PATTERN.test(model.modelId)
    && (context.mode !== 'MANUAL' || model.id === context.manualModelId));
  if (context.execution) return 1; // Explicit role stages are sequential, including shared credentials.
  if (context.fallbackEnabled === false) return 1;
  return Math.max(1, new Set(routes.map(model => model.connectionId)).size);
}

function stableId(value: string): number {
  return -(parseInt(createHash('sha256').update(value).digest('hex').slice(0, 7), 16) + 1);
}

export function byokConnectionId(context: ByokContext, keyId: number): string | undefined {
  return context.models.find(model => stableId(context.userId + model.connectionId) === keyId)?.connectionId;
}

export function byokModelOnCooldown(userId: string, model: ByokModel): boolean {
  return isOnCooldown(model.providerId, model.modelId, stableId(userId + model.connectionId));
}

export const NON_CHAT_MODEL_PATTERN = /(?:^|[\/_-])(?:embed|embedding|rerank|moderation|guard|nemoguard|safety|whisper|tts|stt|asr|transcri|canary|calibration|ising|detector|deplot|parse|reward|evaluator|classifier|clip|ocr)(?:[\/_-]|$)|(?:bge|e5|gte)-/i;

export function routeByokRequest(
  context: ByokContext, estimatedTokens: number, skipKeys?: Set<string>, preferredModel?: number | string,
  requireVision = false, requireTools = false, allowedModelIds?: ReadonlySet<string>,
): RouteResult {
  if (context.fallbackEnabled === false && skipKeys?.size) {
    const error = new Error('Fallback is disabled for this request.') as Error & { status?: number };
    error.status = 503;
    throw error;
  }
  const selectedId = context.assignedModelId || context.execution?.primaryModelId;
  const sequence = selectedId ? [selectedId, ...(context.fallbackEnabled !== false ? context.execution?.fallbackModelIds || [] : [])].filter((id, index, all) => all.indexOf(id) === index) : null;
  const candidates = context.models.filter(model => model.enabled && model.capabilities.text && model.capabilities.streaming
    && (!sequence || sequence.includes(model.id))
    && !NON_CHAT_MODEL_PATTERN.test(model.modelId)
    && (context.execution || context.assignedModelId || context.mode !== 'MANUAL' || model.id === context.manualModelId)
    && (!requireVision || model.capabilities.vision)
    && (!requireTools || model.capabilities.toolCalling && model.toolsEnabled !== false)
    && (!model.contextWindow || estimatedTokens <= model.contextWindow)
    && (!allowedModelIds || allowedModelIds.has(model.modelId))
    && !skipKeys?.has(`${model.providerId}:${model.modelId}:*`)
    && !isOnCooldown(model.providerId, model.modelId, stableId(context.userId + model.connectionId))
    && !skipKeys?.has(`${model.providerId}:${model.modelId}:${stableId(context.userId + model.connectionId)}`)
    && !skipKeys?.has(`${model.providerId}:*:${stableId(context.userId + model.connectionId)}`));
  candidates.sort((a, b) => {
    if (sequence) return sequence.indexOf(a.id) - sequence.indexOf(b.id);
    const preferredA = preferredModel === a.modelId || preferredModel === a.displayName || preferredModel === stableId(a.id);
    const preferredB = preferredModel === b.modelId || preferredModel === b.displayName || preferredModel === stableId(b.id);
    if (preferredA !== preferredB) return preferredA ? -1 : 1;
    const value = (model: ByokModel) => {
      const compact = /flash|mini|small|lite|instant|haiku|8b/.test(model.modelId.toLowerCase());
      return (model.priority ?? 0) + (model.id === context.preferredModelId ? 4 : 0)
        + (context.mode === 'DEEP' || context.taskType === 'reasoning' ? (model.capabilities.reasoning ? 5 : 0) : 0)
        + (context.taskType === 'coding' && /code|devstral|codestral/.test(model.modelId.toLowerCase()) ? 2 : 0)
        + (context.mode === 'FAST' || context.mode === 'EFFICIENT' ? (compact ? 3 : 0) : 0)
        - healthPenalty(context.userId, model.providerId, model.modelId);
    };
    return value(b) - value(a) || a.id.localeCompare(b.id);
  });
  for (const model of candidates) {
    const provider = resolveProvider(model.providerId as Platform, model.baseUrl, true);
    if (!provider) continue;
    // Decrypt only after capability filtering and selection, within this request.
    const apiKey = decrypt(model.encryptedKey, model.iv, model.authTag);
    return { provider, modelId: model.modelId, modelDbId: stableId(model.id), apiKey,
      keyId: stableId(context.userId + model.connectionId), platform: model.providerId,
      displayName: model.displayName, supportsTools: model.capabilities.toolCalling,
      toolsAllowed: model.toolsEnabled !== false,
      tpmLimit: null, remainingTpmTokens: null, remainingTpdTokens: null, rpdLimit: null, tpdLimit: null };
  }
  const error = new Error('No compatible connected model is available. Connect a provider or enable a compatible model.') as Error & { status?: number };
  error.status = 422;
  throw error;
}
