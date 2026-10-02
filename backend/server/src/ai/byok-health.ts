type State = { latencyEma: number | null; successEma: number; samples: number; updatedAt: number };
const states = new Map<string, State>();
const MAX_ENTRIES = 10_000;
const HALF_LIFE_MS = 30 * 60_000;
export type RuntimeHealth = { status: 'unknown' | 'healthy' | 'rate_limited' | 'unavailable'; retryAt: number | null; checkedAt: number | null };
const runtimeHealth = new Map<string, RuntimeHealth>();

export function getByokRuntimeHealth(userId: string, connectionId: string, modelId: string): RuntimeHealth {
  const id = key(userId, connectionId, modelId);
  const item = runtimeHealth.get(id);
  // A retry deadline is permission to check again, not evidence of recovery.
  return item ?? { status: 'unknown', retryAt: null, checkedAt: null };
}

function key(userId: string, providerId: string, modelId: string) { return `${userId}:${providerId}:${modelId}`; }

export function healthPenalty(userId: string, providerId: string, modelId: string): number {
  const item = states.get(key(userId, providerId, modelId));
  if (!item) return 0;
  const age = Math.max(0, Date.now() - item.updatedAt);
  const decay = Math.exp(-age / HALF_LIFE_MS);
  return (1 - item.successEma) * 6 * decay + (item.latencyEma ? Math.min(item.latencyEma / 20_000, 2) : 0) * decay;
}

export function recordByokOutcome(userId: string, providerId: string, modelId: string, success: boolean, latencyMs: number, details?: { connectionId?: string; error?: unknown; source?: 'probe'; startedAt?: number }): void {
  if (details?.connectionId) {
    const id = key(userId, details.connectionId, modelId);
    const previous = runtimeHealth.get(id);
    // A probe that overlapped a failed turn cannot erase its failure feedback.
    if (success && details.source === 'probe' && previous && previous.status !== 'healthy'
      && (previous.checkedAt! > (details.startedAt ?? 0) || previous.retryAt! > Date.now())) return;
    if (success) runtimeHealth.set(id, { status: 'healthy', retryAt: null, checkedAt: Date.now() });
    else {
      const error = details.error as { status?: number; statusCode?: number; message?: string } | undefined;
      const rateLimited = error?.status === 429 || error?.statusCode === 429 || /\b429\b|rate.?limit|too many requests|quota/i.test(error?.message || '');
      runtimeHealth.set(id, { status: rateLimited ? 'rate_limited' : 'unavailable', retryAt: Date.now() + (rateLimited ? 60_000 : 30_000), checkedAt: Date.now() });
    }
    if (runtimeHealth.size > MAX_ENTRIES) runtimeHealth.delete(runtimeHealth.keys().next().value!);
  }
  const id = key(userId, providerId, modelId);
  const old = states.get(id);
  const alpha = 0.22;
  states.set(id, { successEma: old ? (1 - alpha) * old.successEma + alpha * Number(success) : Number(success),
    latencyEma: success ? old?.latencyEma != null ? (1 - alpha) * old.latencyEma + alpha * latencyMs : latencyMs : old?.latencyEma ?? null,
    samples: (old?.samples ?? 0) + 1, updatedAt: Date.now() });
  if (states.size > MAX_ENTRIES) {
    const oldest = states.keys().next().value;
    if (oldest) states.delete(oldest);
  }
}
