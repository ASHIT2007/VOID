import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ loop: vi.fn(), search: vi.fn() }));
vi.mock('../../agent/agent-loop.js', () => ({ runAgentLoop: mocks.loop }));
vi.mock('../../agent/tool-registry.js', () => ({ getTool: () => ({ name: 'image_search', handler: mocks.search }) }));
import { deriveMediaSubject, evaluateMediaRelevance, groundMediaInAnswer, parseSemanticMediaDecision, runMediaWorker, type SemanticMediaDecision, type MediaPlan } from '../../agent/media-orchestrator.js';
import type { AgentEvent } from '../../agent/agent-loop.js';

const image = { url: 'https://upload.wikimedia.org/Snow_leopard.jpg', title: 'Snow leopard in natural habitat', sourceUrl: 'https://en.wikipedia.org/wiki/Snow_leopard', sourceDomain: 'wikipedia.org', width: 1200, height: 800, verified: true, confidence: .95 };
const allow: SemanticMediaDecision = { should_search: true, category: 'explicit_request', visual_subject: 'Snow leopard', reason: 'The user requested a reference photo.' };
const plan: MediaPlan = { decision: 'search', reason: 'Requested photo', subject: 'Snow leopard', queries: ['Snow leopard'], altText: 'Snow leopard', placement: 'inline', safetyCategory: 'none' };
const classify = (decision: SemanticMediaDecision | string) => mocks.loop.mockImplementation(async options => options.onEvent({ type: 'text_delta', content: typeof decision === 'string' ? decision : JSON.stringify(decision) }));
beforeEach(() => { mocks.loop.mockReset(); mocks.search.mockReset(); mocks.search.mockResolvedValue({ content: 'Verified photo', images: [image] }); });

describe('semantic image intent and grounding', () => {
  it('reports a classifier outage as a failure, never as a no-image intent decision', async () => {
    mocks.loop.mockRejectedValue(new Error('429'));
    const events: AgentEvent[] = [];
    expect(await runMediaWorker({ message: 'give image of an lepord', responseText: 'Leopards are spotted cats.', mode: 'normal', onEvent: () => {} }, event => events.push(event))).toEqual([]);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: 'media_status', status: 'failed', reason: expect.stringContaining('quota') });
  });
  it.each([
    ['what is your name', 'meta_assistant'], ['waht is your name a', 'meta_assistant'],
    ['who created python', 'abstract_logic'], ['how do I reverse a binary tree in python', 'abstract_logic'],
    ['hello how are you', 'conversational'], ['what is love', 'abstract_logic'],
  ] as const)('honors the semantic veto for %s without any image search', async (message, category) => {
    classify({ should_search: false, category, visual_subject: null, reason: 'No concrete visual request.' });
    const events: AgentEvent[] = [];
    const result = await runMediaWorker({ message, responseText: 'A complete text answer.', mode: 'normal', onEvent: () => {} }, event => events.push(event));
    expect(result).toEqual([]); expect(mocks.search).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: 'media_status', status: 'omitted' });
    const options = mocks.loop.mock.calls[0][0];
    expect(JSON.parse(options.message).request).toBe(message);
    expect(options).toMatchObject({ internalTask: 'media_relevance', allowedTools: [], searchMode: 'off', maxProviderAttempts: 2, maxIterations: 1 });
    expect(options.systemContext).toContain('waht is your name a');
    expect(options.systemContext).toContain('Tool availability and execution/search policies MUST NOT affect should_search');
  });
  it('returns verified snow leopard imagery only after the answer is grounded', async () => {
    classify(allow); const events: AgentEvent[] = [];
    const result = await runMediaWorker({ message: 'show me a snow leopard', responseText: 'The snow leopard lives in the mountains of Asia.', mode: 'normal', onEvent: () => {} }, event => events.push(event));
    expect(result).toHaveLength(1); expect(result[0].verified).toBe(true);
    expect(mocks.search.mock.calls[0][0].query).toBe('Snow leopard');
    expect(events.some(event => event.type === 'media')).toBe(true);
  });
  it('omits on classifier error, missing fields, prose or ambiguous subject', async () => {
    for (const text of ['search for photos', '{}', JSON.stringify({ ...allow, visual_subject: 'your name' }), JSON.stringify({ ...allow, category: 'meta_assistant' })]) {
      classify(text);
      expect(await runMediaWorker({ message: 'what is your name', responseText: 'I am VOID.', mode: 'normal', onEvent: () => {} }, () => {})).toEqual([]);
    }
    expect(mocks.search).not.toHaveBeenCalled();
    mocks.loop.mockRejectedValue(new Error('429'));
    expect((await evaluateMediaRelevance({ message: 'Ferrari F40', mode: 'normal', onEvent: () => {} }, 'Ferrari F40 is a car.')).should_search).toBe(false);
  });
  it('allows a valid search and validation to finish after the former six-second cutoff', async () => {
    vi.useFakeTimers();
    try {
      classify(allow);
      mocks.search.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ content: 'Photo', images: [image] }), 6500)));
      const result = runMediaWorker({ message: 'show me a snow leopard', responseText: 'Snow leopards are mountain cats.', mode: 'normal', onEvent: () => {} }, () => {});
      await vi.advanceTimersByTimeAsync(6500);
      expect(await result).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('extracts only canonical entities, never question substrings or pronouns', () => {
    expect(deriveMediaSubject('what is your name')).toBe('');
    expect(deriveMediaSubject('scaled mammal from Africa', { ...allow, visual_subject: 'Pangolin' })).toBe('Pangolin');
    for (const subject of ['your name', 'my name', 'yourself', 'this', 'it', 'someone']) expect(deriveMediaSubject('', { ...allow, visual_subject: subject })).toBe('');
    expect(parseSemanticMediaDecision(JSON.stringify({ ...allow, should_search: false })).visual_subject).toBeNull();
  });
  it('drops homonyms and images whose subject is absent from the final response', () => {
    expect(groundMediaInAnswer([image], plan, 'Here is an explanation of Python.')).toEqual([]);
    expect(groundMediaInAnswer([{ ...image, title: 'Mountain scenery', url: 'https://upload.wikimedia.org/mountains.jpg' }], plan, 'Snow leopards live in mountains.')).toEqual([]);
    expect(groundMediaInAnswer([image], plan, 'A snow leopard is a large cat.')).toEqual([image]);
  });
});
