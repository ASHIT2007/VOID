import 'server-only';

export type RoutedCandidate = { id: string; connection_id?: string; provider_id: string; priority?: number; enabled?: boolean; status?: string };
const cooldown = new Map<string, number>();

export function orderCandidates<T extends RoutedCandidate>(items: T[], preferredId?: string | null, fallbackEnabled = true): T[] {
  const now = Date.now();
  const available = items.filter(item => item.enabled !== false && item.status !== 'invalid');
  if (!fallbackEnabled) return available.sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId)
    || (b.priority || 0) - (a.priority || 0)).slice(0, 1);
  const healthy = available.filter(item => (cooldown.get(item.connection_id || item.id) || 0) <= now);
  const ordered = (healthy.length ? healthy : available)
    .sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId) || (b.priority || 0) - (a.priority || 0));
  return ordered;
}

export function recordProviderFailure(id: string, status?: number): void {
  const delay = status === 429 ? 60_000 : status && status >= 500 ? 20_000 : 10_000;
  cooldown.set(id, Date.now() + delay);
}

export function recordProviderSuccess(id: string): void { cooldown.delete(id); }
