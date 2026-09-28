import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ToolResult } from './tool-registry.js';
export type ClientToolEvent = { type: 'client_tool'; requestId: string; token: string; name: string; args: Record<string, unknown>; expiresAt: number };
type Context = { userId: string; signal: AbortSignal; emit: (event: ClientToolEvent) => void };
const context = new AsyncLocalStorage<Context>();
const pending = new Map<string, { userId: string; token: string; resolve: (result: ToolResult) => void }>();
export function withClientTools<T>(value: Context, action: () => Promise<T>) { return context.run(value, action); }
export async function requestClientTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const current = context.getStore();
  if (!current || current.signal.aborted) return { content: 'This operation requires the signed-in browser workspace.', error: 'browser_unavailable' };
  if (pending.size >= 100) return { content: 'The device workspace is busy. Please retry.', error: 'workspace_busy' };
  const requestId = randomUUID(), token = randomBytes(32).toString('hex');
  // Decks may prepare several model-generated visuals in bounded batches.
  const timeoutMs = name === 'generate_presentation' ? 600_000 : 120_000;
  return new Promise(resolve => {
    const complete = (result: ToolResult) => { clearTimeout(timer); current.signal.removeEventListener('abort', aborted); pending.delete(requestId); resolve(result); };
    const aborted = () => complete({ content: 'The operation was cancelled.', error: 'cancelled' });
    const timer = setTimeout(() => complete({ content: 'The browser operation timed out without completing. No success can be assumed.', error: 'browser_timeout' }), timeoutMs);
    pending.set(requestId, { userId: current.userId, token, resolve: complete });
    current.signal.addEventListener('abort', aborted, { once: true });
    try { current.emit({ type: 'client_tool', requestId, token, name, args, expiresAt: Date.now() + timeoutMs }); }
    catch { complete({ content: 'The browser could not receive this operation. No success can be assumed.', error: 'browser_unavailable' }); }
  });
}
export function completeClientTool(userId: string, requestId: string, token: string, result: ToolResult): boolean {
  const item = pending.get(requestId);
  if (!item || item.userId !== userId || item.token !== token) return false;
  item.resolve(result); return true;
}
