import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentLoopOptions } from '../../agent/agent-loop.js';

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../agent/agent-loop.js', () => ({ runAgentLoop: run }));
import { canShowResponseOpening, startResponseOpening } from '../../agent/response-opening.js';

afterEach(() => { vi.useRealTimers(); run.mockReset(); });

describe('progressive public opening', () => {
  it('streams a completed contextual opening followed by an actual working phase', async () => {
    run.mockImplementation(async (options: AgentLoopOptions) => {
      options.onEvent({ type: 'text_delta', content: 'I’ll compare the two inventory designs and their tradeoffs.' });
      options.onEvent({ type: 'done', fullText: '' });
    });
    const events: AgentEvent[] = [];
    startResponseOpening({ mode: 'normal', message: 'Compare inventory designs', onEvent: event => events.push(event) });
    await Promise.resolve();
    expect(events.map(event => event.type)).toEqual(['text_delta', 'thinking']);
    expect(run.mock.calls[0][0]).toMatchObject({ allowedTools: [], maxOutputTokens: 128, maxIterations: 1 });
  });
  it('never inserts a late opening after synthesis has begun', async () => {
    let pending!: AgentLoopOptions;
    run.mockImplementation(async (options: AgentLoopOptions) => { pending = options; });
    const onEvent = vi.fn();
    const cancel = startResponseOpening({ mode: 'normal', message: 'Compare designs', onEvent });
    cancel();
    pending.onEvent({ type: 'text_delta', content: 'A late opening.' });
    pending.onEvent({ type: 'done', fullText: 'A late opening.' });
    await Promise.resolve();
    expect(onEvent).not.toHaveBeenCalled();
    expect(pending.signal?.aborted).toBe(true);
  });
  it('times out silently and never renders incomplete or private reasoning', async () => {
    vi.useFakeTimers();
    let pending!: AgentLoopOptions;
    run.mockImplementation((options: AgentLoopOptions) => { pending = options; return new Promise(() => {}); });
    const onEvent = vi.fn();
    startResponseOpening({ mode: 'normal', message: 'Compare designs', onEvent });
    pending.onEvent({ type: 'text_delta', content: '<think>private content' });
    await vi.advanceTimersByTimeAsync(8001);
    pending.onEvent({ type: 'done', fullText: '' });
    expect(pending.signal?.aborted).toBe(true);
    expect(onEvent).not.toHaveBeenCalled();
  });
  it('respects exact output requests', () => {
    expect(canShowResponseOpening('Compare the designs.')).toBe(true);
    expect(canShowResponseOpening('Return JSON only.')).toBe(false);
    expect(canShowResponseOpening('Reply with exactly one word.')).toBe(false);
    expect(canShowResponseOpening('No preamble, just the code.')).toBe(false);
  });
});
