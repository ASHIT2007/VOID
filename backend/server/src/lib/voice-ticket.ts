import { randomBytes } from 'node:crypto';

const tickets = new Map<string, number>();
export function issueVoiceTicket(): string {
  for (const [key, expires] of tickets) if (expires <= Date.now()) tickets.delete(key);
  if (tickets.size >= 1000) throw new Error('Too many pending voice connections');
  const token = randomBytes(32).toString('hex');
  tickets.set(token, Date.now() + 60_000);
  return token;
}
export function consumeVoiceTicket(token: string | null): boolean {
  if (!token) return false;
  const expires = tickets.get(token);
  tickets.delete(token);
  return !!expires && expires > Date.now();
}
