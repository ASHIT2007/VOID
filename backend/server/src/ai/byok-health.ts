type State = { latencyEma: number | null; successEma: number; samples: number; updatedAt: number };
const states = new Map<string, State>();
const MAX_ENTRIES = 10_000;
const HALF_LIFE_MS = 30 * 60_000;

function key(userId: string, providerId: string, modelId: string) { return `${userId}:${providerId}:${modelId}`; }

export function healthPenalty(userId: string, providerId: string, modelId: string): number {
  const item = states.get(key(userId, providerId, modelId));
  if (!item) return 0;
  const age = Math.max(0, Date.now() - item.updatedAt);
  const decay = Math.exp(-age / HALF_LIFE_MS);
  return (1 - item.successEma) * 6 * decay + (item.latencyEma ? Math.min(item.latencyEma / 20_000, 2) : 0) * decay;
}

export function recordByokOutcome(userId: string, providerId: string, modelId: string, success: boolean, latencyMs: number): void {
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
