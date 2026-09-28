import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ loop: vi.fn(), media: vi.fn() }));
vi.mock('../../agent/agent-loop.js', () => ({ runAgentLoop: mocks.loop, RESPONSE_FORMATTING_POLICY: '' }));
vi.mock('../../agent/media-orchestrator.js', () => ({ runMediaWorker: mocks.media }));
vi.mock('../../ai/byok-context.js', () => ({ availableChatRouteCount: () => 1, currentByokContext: () => undefined, withByokModel: (_id: string, run: () => Promise<unknown>) => run() }));
import { runAdaptiveOrchestration } from '../../agent/multi-agent-orchestrator.js';
import type { AgentEvent } from '../../agent/agent-loop.js';
beforeEach(() => {
  mocks.loop.mockReset().mockImplementation(async options => { options.onEvent({ type: 'text_delta', content: 'A snow leopard is a mountain cat.' }); options.onEvent({ type: 'done', fullText: 'A snow leopard is a mountain cat.' }); });
  mocks.media.mockReset().mockResolvedValue([]);
});
describe('answer priority over optional media', () => {
  it('uses one answer worker for one credential and runs media only after text is ready', async () => {
    const events: AgentEvent[] = []; let ready = false;
    mocks.media.mockImplementation(async options => { expect(ready).toBe(true); expect(events.some(event => event.type === 'text_delta')).toBe(true); expect(options.responseText).toBe('A snow leopard is a mountain cat.'); return []; });
    await runAdaptiveOrchestration({ message: 'Explain snow leopard anatomy and its mountain habitat', mode: 'deep_research', reasoningEffort: 'high', maxAgents: 4, onAnswerReady: () => { ready = true; }, onEvent: event => events.push(event) });
    expect(mocks.loop).toHaveBeenCalledTimes(1); expect(mocks.media).toHaveBeenCalledTimes(1);
    expect(events.find(event => event.type === 'agent_plan')).toMatchObject({ agents: [expect.anything()] });
    expect(events.at(-1)).toEqual({ type: 'done', fullText: 'A snow leopard is a mountain cat.' });
  });
  it('preserves complete text on media errors and never publishes image-only success', async () => {
    mocks.media.mockRejectedValue(new Error('Image timeout'));
    const events: AgentEvent[] = [];
    await runAdaptiveOrchestration({ message: 'show me a snow leopard', mode: 'normal', onEvent: event => events.push(event) });
    expect(events.at(-1)).toMatchObject({ type: 'done', fullText: 'A snow leopard is a mountain cat.' });
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(events.some(event => event.type === 'response_reset')).toBe(false);
  });
  it('keeps streaming the answer while images finish after the former ten-second deadline', async () => {
    vi.useFakeTimers();
    try {
      const events: AgentEvent[] = [];
      mocks.media.mockImplementation((_options, emit) => new Promise(resolve => setTimeout(() => {
        emit({ type: 'media', query: 'Snow leopard', placement: 'inline', images: [{ url: 'https://upload.wikimedia.org/Snow_leopard.jpg', title: 'Snow leopard', verified: true }] });
        resolve([]);
      }, 11_000)));
      const turn = runAdaptiveOrchestration({ message: 'show me a snow leopard', mode: 'normal', onEvent: event => events.push(event) });
      await vi.advanceTimersByTimeAsync(0);
      expect(events.some(event => event.type === 'text_delta')).toBe(true);
      await vi.advanceTimersByTimeAsync(11_000);
      await turn;
      expect(events.some(event => event.type === 'media')).toBe(true);
      expect(events.at(-1)).toMatchObject({ type: 'done', fullText: 'A snow leopard is a mountain cat.' });
    } finally { vi.useRealTimers(); }
  });
  it('never launches image work when the answer route failed', async () => {
    mocks.loop.mockImplementation(async options => options.onEvent({ type: 'error', message: '429 rate limit' }));
    await runAdaptiveOrchestration({ message: 'Who is Satoru Gojo and explain his fight?', mode: 'normal', onEvent: () => {} });
    expect(mocks.media).not.toHaveBeenCalled();
  });
});
