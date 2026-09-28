import { describe, expect, it, vi } from 'vitest';
import { completeClientTool, requestClientTool, withClientTools, type ClientToolEvent } from '../../agent/client-tools.js';
describe('device workspace bridge', () => {
  it('requires a browser context and binds a one-use result to its owner and secret', async () => {
    expect((await requestClientTool('code_execution', {})).error).toBe('browser_unavailable');
    const events: ClientToolEvent[] = [];
    const work = withClientTools({ userId: 'alice', signal: new AbortController().signal, emit: e => events.push(e) }, () => requestClientTool('file_write', { filename: 'test.txt', content: 'example' }));
    const event = events[0];
    expect(completeClientTool('bob', event.requestId, event.token, { content: 'wrong user' })).toBe(false);
    expect(completeClientTool('alice', event.requestId, 'wrong-token', { content: 'wrong token' })).toBe(false);
    expect(completeClientTool('alice', event.requestId, event.token, { content: 'Approved device result' })).toBe(true);
    expect(await work).toEqual({ content: 'Approved device result' });
    expect(completeClientTool('alice', event.requestId, event.token, { content: 'replay' })).toBe(false);
  });
  it('cleans up cancellation and times out without assuming an action succeeded', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController(); let event!: ClientToolEvent;
      const cancelled = withClientTools({ userId: 'alice', signal: controller.signal, emit: e => { event = e; } }, () => requestClientTool('memory_delete', { key: 'x' }));
      controller.abort(); expect((await cancelled).error).toBe('cancelled');
      expect(completeClientTool('alice', event.requestId, event.token, { content: 'late' })).toBe(false);
      const timeout = withClientTools({ userId: 'alice', signal: new AbortController().signal, emit: e => { event = e; } }, () => requestClientTool('code_execution', {}));
      await vi.advanceTimersByTimeAsync(120000); expect((await timeout).error).toBe('browser_timeout');
      expect(completeClientTool('alice', event.requestId, event.token, { content: 'late' })).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('allows bounded presentation-image batches to finish while binding the result to the owner', async () => {
    vi.useFakeTimers();
    try {
      let event!: ClientToolEvent;
      const work = withClientTools({ userId: 'alice', signal: new AbortController().signal, emit: e => { event = e; } }, () => requestClientTool('generate_presentation', {}));
      expect(event.expiresAt - Date.now()).toBe(600_000);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(completeClientTool('alice', event.requestId, event.token, { content: 'Deck prepared' })).toBe(true);
      expect(await work).toEqual({ content: 'Deck prepared' });
    } finally { vi.useRealTimers(); }
  });
});
