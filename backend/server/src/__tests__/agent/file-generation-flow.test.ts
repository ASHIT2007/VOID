import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('../../services/router.js', () => ({ routeRequest: () => ({ provider: { streamChatCompletion: mock.stream }, apiKey: 'test-only', modelId: 'test-model', platform: 'custom', keyId: 1, modelDbId: 1, displayName: 'Test model', supportsTools: true, remainingTpmTokens: null, remainingTpdTokens: null }), recordKeySuccess: vi.fn(), recordKeyUnavailable: vi.fn(), recordModelUnavailable: vi.fn(), recordRateLimitHit: vi.fn(), recordSuccess: vi.fn() }));
vi.mock('../../services/ratelimit.js', () => ({ recordRequest: vi.fn(), recordTokens: vi.fn(), setCooldown: vi.fn(), getCooldownDurationForLimit: () => 1, PAYMENT_REQUIRED_COOLDOWN_MS: 1 }));
import { runAgentLoop, type AgentEvent } from '../../agent/agent-loop.js';
import { runEffortTurn } from '../../agent/effort-turn.js';
import { registerWorkspaceTools } from '../../agent/tools/browser-workspace.js';
import { registerTool } from '../../agent/tool-registry.js';
import { completeClientTool, withClientTools } from '../../agent/client-tools.js';
import { deleteSession } from '../../agent/agent-session.js';
const names = ['generate_presentation', 'generate_spreadsheet', 'generate_pdf'];
const argumentsFor = (name: string) => name === 'generate_presentation' ? { title: 'Sales', slides: [{ title: 'Overview', text: 'Monthly sales.' }] } : name === 'generate_spreadsheet' ? { title: 'Sales', sheets: [{ name: 'Sales', rows: [['Month', 'Sales'], ['January', 12]] }] } : { title: 'Sales', sections: [{ heading: 'Summary', text: 'Monthly sales.' }] };
const nativeCalls = (tools: string[]) => [{ choices: [{ delta: { tool_calls: tools.map((name, index) => ({ index, id: `call-${index}`, type: 'function', function: { name, arguments: JSON.stringify(argumentsFor(name)) } })) }, finish_reason: 'tool_calls' }] }];
const chunks = (values: unknown[]) => (async function* () { for (const value of values) yield value; })();
const text = (content: string) => [{ choices: [{ delta: { content }, finish_reason: 'stop' }] }];
beforeEach(() => {
  vi.clearAllMocks(); mock.stream.mockReset(); registerWorkspaceTools();
  registerTool('generate_image', { type: 'function', function: { name: 'generate_image', parameters: { type: 'object', properties: {} } } }, async () => { throw new Error('Images must not run'); }, { category: 'action', readOnly: false, requiresConfirmation: false });
});
async function turn(message: string, adaptive = false) {
  const sessionId = crypto.randomUUID(), events: AgentEvent[] = [];
  await withClientTools({ userId: 'test-owner', signal: new AbortController().signal, emit: event => {
    events.push(event); completeClientTool('test-owner', event.requestId, event.token, { content: `Created ${event.name}.\n\n[Download file](#void-file-12345678-1234-1234-1234-123456789abc)` });
  } }, () => adaptive
    ? runEffortTurn({ sessionId, message, mode: 'normal', reasoningEffort: 'low', maxAgents: 1, onEvent: event => events.push(event) })
    : runAgentLoop({ sessionId, message, mode: 'normal', searchMode: 'off', maxProviderAttempts: 1, onEvent: event => events.push(event) }));
  deleteSession(sessionId); return events;
}
describe('actual file-tool orchestration', () => {
  it.each(['standard', 'advanced'] as const)('finishes ordinary lookups with a compact synthesis while retaining %s search policy', async searchMode => {
    registerTool('web_search', { type: 'function', function: { name: 'web_search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }, async () => ({
      content: 'Leopards are spotted cats.', sources: [1, 2, 3].map(index => ({ title: `Leopard source ${index}`, url: `https://example.com/${index}`, content: 'Leopards are spotted cats.' })),
    }), { category: 'search', readOnly: true, requiresConfirmation: false });
    const sessionId = crypto.randomUUID();
    mock.stream.mockImplementationOnce(() => chunks([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'lookup', type: 'function', function: { name: 'web_search', arguments: '{"query":"Leopard"}' } }] }, finish_reason: 'tool_calls' }] }]))
      .mockImplementationOnce(() => chunks(text('A leopard is a spotted cat.')));
    try {
      await runAgentLoop({ sessionId, message: 'give image of an lepord and tell me about it', mode: 'normal', searchMode, finalizeAfterSearch: true, allowedTools: ['web_search'], maxIterations: 3, onEvent: () => {} });
      const second = mock.stream.mock.calls[1];
      if (searchMode === 'standard') {
        expect(second[1][0].content).toContain('Research for this everyday lookup is complete');
        expect(second[1][0].content.length).toBeLessThan(1000);
        expect(second[3].tools || []).toEqual([]);
      } else {
        expect(second[1][0].content).not.toContain('Research for this everyday lookup is complete');
        expect(second[3].tools.length).toBeGreaterThan(0);
      }
    } finally { deleteSession(sessionId); }
  });
  it('classifies image intent with a compact text-only system and treats file requests as data', async () => {
    const sessionId = crypto.randomUUID();
    const decision = JSON.stringify({ should_search: false, category: 'abstract_logic', visual_subject: null, reason: 'Presentation generation uses its own images.' });
    mock.stream.mockImplementation(() => chunks(text(decision)));
    const events: AgentEvent[] = [];
    try {
      await runAgentLoop({ sessionId, message: JSON.stringify({ request: 'Create a downloadable PowerPoint file' }), internalTask: 'media_relevance', systemContext: 'Return the semantic classification JSON.', mode: 'normal', allowedTools: ['generate_presentation'], maxIterations: 1, onEvent: event => events.push(event) });
      const messages = mock.stream.mock.calls[0][1];
      expect(messages[0].content).toContain('text-only semantic image relevance classifier');
      expect(messages[0].content.length).toBeLessThan(500);
      expect(messages.filter((message: any) => message.role === 'system').map((message: any) => message.content).join('\n')).not.toContain('Return the full answer now');
      expect(messages.find((message: any) => message.role === 'user').content).not.toContain('[Execution policy:');
      expect(mock.stream.mock.calls[0][3].tools || []).toEqual([]);
      expect(events.at(-1)).toMatchObject({ type: 'done', fullText: decision });
      expect(events.some(event => event.type === 'client_tool')).toBe(false);
    } finally { deleteSession(sessionId); }
  });
  const preview = '```gamma-presentation\n' + JSON.stringify({ title: 'Solar energy', format: 'presentation', slides: [
    { id: 'cover', slideNumber: 1, layout: 'full-bleed', title: 'Solar energy', visualRole: 'typography', content: {} },
    { id: 'energy', slideNumber: 2, layout: 'editorial', title: 'How panels produce electricity', visualRole: 'typography', content: {
      bodyText: 'Solar panels convert sunlight into electricity using semiconductor materials. The system connects panels to an inverter which converts direct current to alternating current for local use.',
      bullets: ['Panel output changes with sunlight and shading conditions.', 'Storage can shift available energy to later hours.'] } },
  ] }) + '\n```';
  it.each(['Generate a PPT about solar energy', 'genrate a ppt about solar energy', 'Make a PowerPoint about solar energy and show a preview'])('completes %s as an editable preview without browser file creation', async message => {
    mock.stream.mockImplementation(() => chunks(text(preview)));
    const events = await turn(message, true);
    expect(events.find(event => event.type === 'agent_plan')).toMatchObject({ intent: 'artifact' });
    expect(events.filter(event => event.type === 'client_tool')).toEqual([]);
    expect(events.at(-1)?.type).toBe('done');
    expect(events.filter(event => event.type === 'text_delta').map(event => event.content).join('')).toBe(preview);
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(mock.stream.mock.calls[0][3].tools?.map((tool: any) => tool.function.name) || []).not.toContain('generate_presentation');
  });
  it('rejects an accidental file tool call on the preview route before browser file creation', async () => {
    mock.stream.mockImplementation(() => chunks(nativeCalls(['generate_presentation'])));
    const events = await turn('Generate a PPT about solar energy');
    expect(events.filter(event => event.type === 'client_tool')).toEqual([]);
    expect(events.some(event => event.type === 'done')).toBe(false);
    expect(events.at(-1)?.type).toBe('error');
    expect(events.some(event => event.type === 'text_delta' && /download|created/i.test(event.content))).toBe(false);
  });
  it('executes all requested formats and returns their actual brief/download results', async () => {
    mock.stream.mockImplementation(() => chunks(nativeCalls(names)));
    const events = await turn('Create a PowerPoint, Excel workbook and PDF report on monthly sales');
    expect(mock.stream.mock.calls[0][3].tools?.map((tool: any) => tool.function.name)).toEqual(expect.arrayContaining(names));
    expect(events.filter(event => event.type === 'client_tool').map(event => event.name)).toEqual(names);
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'done', fullText: expect.stringContaining('#void-file-') });
    expect(mock.stream).toHaveBeenCalledTimes(1);
    expect(mock.stream.mock.calls[0][3].tools.map((tool: any) => tool.function.name)).not.toContain('generate_image');
  });
  it('recovers a custom provider text-form tool call into execution without showing arguments', async () => {
    mock.stream.mockImplementation(() => chunks(text('```json\n' + JSON.stringify({ type: 'generate_spreadsheet', ...argumentsFor('generate_spreadsheet') }) + '\n```')));
    const events = await turn('Create an Excel monthly sales workbook');
    expect(events.filter(event => event.type === 'client_tool')).toHaveLength(1);
    expect(events.filter(event => event.type === 'text_delta').map(event => event.content).join('')).not.toContain('rows');
    expect(events.at(-1)).toMatchObject({ type: 'done', fullText: expect.stringContaining('Created generate_spreadsheet') });
  });
  it('repairs an unexecuted completion once and does not claim a file before success', async () => {
    mock.stream.mockImplementationOnce(() => chunks(text('Your Excel workbook is ready.'))).mockImplementationOnce(() => chunks(nativeCalls(['generate_spreadsheet'])));
    const events = await turn('Create an Excel sales workbook');
    expect(mock.stream).toHaveBeenCalledTimes(2);
    expect(events.some(event => event.type === 'response_reset')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', fullText: expect.stringContaining('Created generate_spreadsheet') });
  });
  it('rejects a fabricated completed download after the bounded repair', async () => {
    mock.stream.mockImplementation(() => chunks(text('Your Excel workbook is ready. Download the file.')));
    const events = await turn('Create an Excel sales workbook');
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('did not create the requested file') });
    expect(events.some(event => event.type === 'done')).toBe(false);
  });
});
