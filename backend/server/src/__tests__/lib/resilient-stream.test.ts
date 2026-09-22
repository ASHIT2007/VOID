import { describe, it, expect } from 'vitest';
import { resilientStream } from '../../lib/resilient-stream.js';

describe('provider stream failover deadline', () => {
  it('aborts a provider that never sends its first chunk', async () => {
    const controller = new AbortController();
    async function* stalled() { await new Promise(() => {}); yield 'unreachable'; }
    const stream = resilientStream(stalled(), controller, 10, 10);
    await expect(stream.next()).rejects.toThrow('timed out');
    expect(controller.signal.aborted).toBe(true);
  });

  it('aborts a stream that stalls after partial output', async () => {
    const controller = new AbortController();
    async function* stalled() { yield 'partial'; await new Promise(() => {}); yield 'unreachable'; }
    const stream = resilientStream(stalled(), controller, 10, 10);
    expect((await stream.next()).value).toBe('partial');
    await expect(stream.next()).rejects.toThrow('timed out');
  });

  it('preserves successful chunks and the completion boundary', async () => {
    async function* response() { yield 'one'; yield 'two'; }
    const chunks = [];
    for await (const chunk of resilientStream(response(), new AbortController())) chunks.push(chunk);
    expect(chunks).toEqual(['one', 'two']);
  });

  it('stops immediately on user cancellation without waiting for timeout', async () => {
    const controller = new AbortController();
    async function* stalled() { await new Promise(() => {}); yield 'unreachable'; }
    const next = resilientStream(stalled(), controller).next();
    controller.abort(new Error('Cancelled by user'));
    await expect(next).rejects.toThrow('Cancelled by user');
  });
});
