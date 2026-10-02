import { createHash } from 'node:crypto';
import { z } from 'zod';
import { decrypt } from '../lib/crypto.js';
import { currentByokContext } from './byok-context.js';

export const searchCredentialSchema = z.object({
  id: z.string().uuid(), providerId: z.enum(['tavily', 'brave']),
  encryptedKey: z.string().max(16384), iv: z.string().max(128), authTag: z.string().max(128),
  priority: z.number().int().min(0).max(100).default(0),
});
export type SearchCredential = z.infer<typeof searchCredentialSchema>;
const cooldowns = new Map<string, { until: number; issue: string }>();

export function userSearchCredentials(providerId?: SearchCredential['providerId']): SearchCredential[] {
  // Only the authenticated request's encrypted credentials are eligible.
  // Never consult shared server search keys, even without a BYOK context.
  return [...(currentByokContext()?.searchCredentials || [])].filter(item => !providerId || item.providerId === providerId)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
function identity(credential: SearchCredential): string {
  return `${currentByokContext()?.userId || 'none'}:${credential.id}:${createHash('sha256').update(credential.encryptedKey).digest('hex')}`;
}
export function searchCredentialAvailable(credential: SearchCredential): boolean {
  const state = cooldowns.get(identity(credential));
  if (state && state.until <= Date.now()) { cooldowns.delete(identity(credential)); return true; }
  return !state;
}
export function openSearchCredential(credential: SearchCredential): string {
  return decrypt(credential.encryptedKey, credential.iv, credential.authTag);
}
export function markSearchFailure(credential: SearchCredential, status?: number): void {
  const name = credential.providerId === 'tavily' ? 'Tavily' : 'Brave';
  const quota = [402, 429, 432, 433].includes(status || 0);
  cooldowns.set(identity(credential), { until: Date.now() + (quota ? 60_000 : 30_000),
    issue: quota ? `${name} search quota is unavailable.` : status === 401 || status === 403 ? `${name} search credentials were rejected.` : `${name} search is temporarily unavailable.` });
  if (cooldowns.size > 10000) cooldowns.delete(cooldowns.keys().next().value!);
}
export function searchCredentialIssues(): string {
  return [...new Set(userSearchCredentials().flatMap(item => cooldowns.get(identity(item))?.issue || []))].join(' ');
}
export function markSearchSuccess(credential: SearchCredential): void { cooldowns.delete(identity(credential)); }
