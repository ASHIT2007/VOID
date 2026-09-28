import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../../agent/agent-loop.js';
const mocks = vi.hoisted(() => ({ adaptive: vi.fn(), loop: vi.fn(), media: vi.fn() }));
vi.mock('../../agent/agent-loop.js', () => ({ runAgentLoop: mocks.loop }));
vi.mock('../../agent/multi-agent-orchestrator.js', () => ({ runAdaptiveOrchestration: mocks.adaptive }));
vi.mock('../../agent/media-orchestrator.js', () => ({ runMediaWorker: mocks.media }));
import { buildEmergencyEvidenceAnswer, runEffortTurn } from '../../agent/effort-turn.js';

describe('answer recovery ownership', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.media.mockResolvedValue([]); });
  it('grounds images in a recovered answer before emitting done', async () => {
    mocks.adaptive.mockImplementation(async options => options.onEvent({ type: 'error', message: '429' }));
    mocks.loop.mockImplementation(async options => options.onEvent({ type: 'done', fullText: 'A leopard is a large spotted cat.' }));
    mocks.media.mockImplementation(async (options, emit) => {
      expect(options.responseText).toBe('A leopard is a large spotted cat.');
      emit({ type: 'media', query: 'Leopard', placement: 'inline', images: [{ url: 'https://example.com/leopard.jpg', verified: true }] });
      return [];
    });
    const events: AgentEvent[] = [];
    await runEffortTurn({ message: 'give image of an lepord and tell me about it', mode: 'normal', onEvent: event => events.push(event) });
    expect(events.findIndex(event => event.type === 'media')).toBeGreaterThan(events.findIndex(event => event.type === 'text_delta'));
    expect(events.at(-1)?.type).toBe('done');
  });
  it('keeps voice reasoning adaptive without imposing written-answer length or disabling research', async () => {
    mocks.adaptive.mockImplementation(async (options) => {
      expect(options.reasoningEffort).not.toBe('auto');
      expect(options.allowedTools).toContain('web_search');
      expect(options.maxAgents).toBe(1);
      expect(options.systemContext).toContain('natural conversation');
      expect(options.systemContext).not.toContain('180–350');
      options.onEvent({ type: 'done', fullText: 'Here is the answer.' });
    });
    await runEffortTurn({ message: 'Explain the latest research on renewable energy and its tradeoffs', mode: 'normal', isVoice: true,
      reasoningEffort: 'auto', allowedTools: ['web_search', 'web_read'], maxAgents: 1, onEvent: () => {} });
    expect(mocks.adaptive).toHaveBeenCalledTimes(1);
    expect(mocks.loop).not.toHaveBeenCalled();
  });
  it('keeps attachment analysis single-agent, local, and free of web tools', async () => {
    mocks.adaptive.mockImplementation(async (options) => {
      expect(options.mode).toBe('normal');
      expect(options.searchMode).toBe('off');
      expect(options.maxAgents).toBe(1);
      expect(options.allowedTools).toEqual([]);
      expect(options.systemContext).toContain('ATTACHMENT-GROUNDED ANSWER');
      options.onEvent({ type: 'text_delta', content: 'The attached presentation states the rule.' });
      options.onEvent({ type: 'done', fullText: 'The attached presentation states the rule.' });
    });
    const events: AgentEvent[] = [];
    await runEffortTurn({
      message: 'Analyze this presentation and explain how CGPA is calculated',
      mode: 'deep_research',
      reasoningEffort: 'high',
      attachments: [{ name: 'rules.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extractedText: 'Slide 2: CGPA rule' }],
      onEvent: event => events.push(event),
    });
    expect(events.find((event) => event.type === 'effort')).toMatchObject({ searchMode: 'off', agentCount: 1 });
    expect(mocks.adaptive).toHaveBeenCalledTimes(1);
  });
  it('keeps actual file tools available when generating from an attachment', async () => {
    mocks.adaptive.mockImplementation(async options => {
      expect(options.allowedTools).toEqual(['generate_pdf']); expect(options.searchMode).toBe('off');
      options.onEvent({ type: 'done', fullText: 'Created the requested PDF.' });
    });
    await runEffortTurn({ message: 'Create a PDF report from the attached file', mode: 'normal', attachments: [{ name: 'notes.txt', type: 'text/plain', extractedText: 'Provided source notes.' }], onEvent: () => {} });
    expect(mocks.loop).not.toHaveBeenCalled();
  });
  it('reports file-generation failures instead of falling into text-only or image recovery', async () => {
    mocks.adaptive.mockImplementation(async options => options.onEvent({ type: 'error', message: 'The PDF generator failed.' }));
    const events: AgentEvent[] = [];
    await runEffortTurn({ message: 'Create a PDF report on solar energy', mode: 'normal', onEvent: event => events.push(event) });
    expect(mocks.loop).not.toHaveBeenCalled(); expect(events.at(-1)).toEqual({ type: 'error', message: 'The PDF generator failed.' });
  });
  it('retains a finished answer when optional media fails afterward', async () => {
    mocks.adaptive.mockImplementation(async (options) => {
      options.onEvent({ type: 'text_delta', content: 'A complete answer.' });
      options.onEvent({ type: 'done', fullText: 'A complete answer.' });
      throw new Error('Optional image deadline');
    });
    const events: AgentEvent[] = [];
    await runEffortTurn({ message: 'Who is Minato Namikaze?', mode: 'normal', onEvent: e => events.push(e) });
    expect(mocks.loop).not.toHaveBeenCalled();
    expect(events.some(e => e.type === 'response_reset')).toBe(false);
    expect(events.at(-1)?.type).toBe('done');
  });
  it('recovers text with no additional tool loop and never emits missing snippets', async () => {
    mocks.adaptive.mockImplementation(async (options) => {
      options.onEvent({ type: 'sources', sources: [{ title: 'Reference', url: 'https://example.com' }] });
      options.onEvent({ type: 'done', fullText: '' });
    });
    mocks.loop.mockImplementation(async (options) => {
      expect(options.allowedTools).toEqual([]);
      expect(options.systemContext).not.toContain('Reference: undefined');
      options.onEvent({ type: 'text_delta', content: 'The recovered complete answer.' });
      options.onEvent({ type: 'done', fullText: 'The recovered complete answer.' });
    });
    const events: AgentEvent[] = [];
    await runEffortTurn({ message: 'Who is Minato Namikaze?', mode: 'normal', onEvent: e => events.push(e) });
    expect(mocks.loop).toHaveBeenCalledTimes(1);
    expect(events.filter(e => e.type === 'text_delta')).toEqual([{ type: 'text_delta', content: 'The recovered complete answer.' }]);
  });

  it('formats emergency evidence as normal chat or speech-safe voice prose', () => {
    const evidence = ['Reference: **A verified fact** from https://example.com [1].'];
    expect(buildEmergencyEvidenceAnswer(evidence)).toContain('- Reference: A verified fact');
    const spoken = buildEmergencyEvidenceAnswer(evidence, true);
    expect(spoken).toContain('Here is what I could verify.');
    expect(spoken).not.toMatch(/https?:|\[[0-9]+\]|[*#_`]/);
  });
});
