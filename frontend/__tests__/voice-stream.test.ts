import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamingSpeechQueue } from '@/lib/voice-stream';

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());

describe('speech while the answer streams', () => {
  it('starts the first sentence before generation finishes and prefetches only one ahead', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const played: string[] = [];
    let preparedCount = 0;
    const prepared = vi.fn(async (text: string) => {
      const index = preparedCount++;
      return async () => { played.push(text); await gates[index].promise; };
    });
    const complete = vi.fn(); const error = vi.fn();
    const queue = new StreamingSpeechQueue(prepared, complete, error);
    queue.push('First sentence. Second sentence. Third sentence.');
    await settle();
    expect(played).toEqual(['First sentence.']);
    expect(prepared).toHaveBeenCalledTimes(2); expect(complete).not.toHaveBeenCalled();
    gates[0].resolve(); await settle();
    expect(played).toEqual(['First sentence.', 'Second sentence.']);
    expect(prepared).toHaveBeenCalledTimes(3);
    queue.finish(); gates[1].resolve(); await settle(); gates[2].resolve(); await settle();
    expect(played).toEqual(['First sentence.', 'Second sentence.', 'Third sentence.']);
    expect(complete).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled();
  });
  it('flushes a short early phrase without speaking a partially generated word', async () => {
    vi.useFakeTimers();
    const played: string[] = [];
    const prepare = vi.fn(async (text: string) => async () => { played.push(text); });
    const complete = vi.fn(); const queue = new StreamingSpeechQueue(prepare, complete, vi.fn());
    queue.push('The answer is photosyn');
    await vi.advanceTimersByTimeAsync(180);
    expect(played).toEqual(['The answer is']); expect(complete).not.toHaveBeenCalled();
    queue.push('thesis.'); await settle(); queue.finish(); await settle();
    expect(played).toEqual(['The answer is', 'photosynthesis.']);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('starts Indic speech without waiting for English punctuation', async () => {
    const played: string[] = []; const complete = vi.fn();
    const queue = new StreamingSpeechQueue(async text => async () => { played.push(text); }, complete, vi.fn());
    queue.push('नमस्ते। यह एक उदाहरण है।'); await settle();
    expect(played).toEqual(['नमस्ते।', 'यह एक उदाहरण है।']);
    expect(complete).not.toHaveBeenCalled(); queue.finish(); expect(complete).toHaveBeenCalledTimes(1);
  });
  it('aborts both prepared phrases and does not play the queued phrase after an interruption', async () => {
    const gate = deferred(); const signals: AbortSignal[] = []; const played: string[] = [];
    const complete = vi.fn(); const error = vi.fn();
    const queue = new StreamingSpeechQueue(async (text, signal) => {
      signals.push(signal); return async () => { played.push(text); await gate.promise; };
    }, complete, error);
    queue.push('First phrase. Second phrase.'); await settle(); queue.cancel(); gate.resolve(); await settle();
    queue.push('Ignored.'); queue.finish();
    expect(played).toEqual(['First phrase.']); expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(complete).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it('reports playback failures once and cancels remaining speech', async () => {
    const complete = vi.fn(); const error = vi.fn();
    const queue = new StreamingSpeechQueue(async () => async () => { throw new Error('Audio unavailable'); }, complete, error);
    queue.push('First. Second.'); queue.finish(); await settle();
    expect(error).toHaveBeenCalledTimes(1); expect(complete).not.toHaveBeenCalled();
  });
});
