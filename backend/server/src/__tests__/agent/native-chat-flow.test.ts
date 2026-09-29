import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('../../services/router.js', () => ({ routeRequest: () => ({ provider: { streamChatCompletion: mock.stream }, apiKey: 'test-only', modelId: 'test-model', platform: 'custom', keyId: 1, modelDbId: 1, displayName: 'Test model', supportsTools: true, remainingTpmTokens: null, remainingTpdTokens: null }), recordKeySuccess: vi.fn(), recordKeyUnavailable: vi.fn(), recordModelUnavailable: vi.fn(), recordRateLimitHit: vi.fn(), recordSuccess: vi.fn() }));
vi.mock('../../services/ratelimit.js', () => ({ recordRequest: vi.fn(), recordTokens: vi.fn(), setCooldown: vi.fn(), getCooldownDurationForLimit: () => 1, PAYMENT_REQUIRED_COOLDOWN_MS: 1 }));
import { runEffortTurn } from '../../agent/effort-turn.js';
import type { AgentEvent } from '../../agent/agent-loop.js';
import { registerDiagramTools } from '../../agent/tools/diagram-renderer.js';
import { registerWorkspaceTools } from '../../agent/tools/browser-workspace.js';
import { completeClientTool, withClientTools } from '../../agent/client-tools.js';
import { withByokContext, type ByokContext } from '../../ai/byok-context.js';
import { inspectionAnswer } from '../../agent/workspace-inspection.js';
import { createExecutionPlan } from '../../agent/task-planner.js';
import { classifyMediaIntent } from '../../agent/media-orchestrator.js';
import { workspaceInspectionTools } from '@void/shared/chat-intent.mjs';
const flow = 'Enter your credentials, validate them, and open the dashboard only when validation succeeds. Otherwise, retry.\n\n```mermaid\nflowchart TD\n  A["Start"] --> B["Enter username and password"]\n  B --> C{"Valid credentials?"}\n  C -->|Yes| D["Dashboard"]\n  C -->|No| B\n```';
const mind = 'Study supervised, unsupervised and reinforcement learning separately. Practice one small project for each approach.\n\n```mermaid\nmindmap\n  root((Machine learning))\n    Supervised learning\n      Classification\n      Regression\n    Unsupervised learning\n      Clustering\n    Reinforcement learning\n      Rewards\n```';
async function* text(content: string) { yield { id: 'test', choices: [{ index: 0, delta: { content }, finish_reason: null }] }; yield { id: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }; }
async function turn(message: string, events: AgentEvent[] = []) {
  await runEffortTurn({ sessionId: crypto.randomUUID(), message, mode: 'deep_research', reasoningEffort: 'high', onEvent: event => events.push(event), signal: new AbortController().signal });
  return events;
}
beforeEach(() => { vi.clearAllMocks(); registerDiagramTools(); registerWorkspaceTools(); });
describe('native requests through the full effort/agent/tool workflow', () => {
  it('does not hijack product prices, billing implementations or machine learning explanations', () => {
    for (const request of ['How much does this car cost?', 'Build a token usage tracker for my app', 'Explain my machine learning models', 'Switch my connected model to model-a']) expect(workspaceInspectionTools(request)).toEqual([]);
  });
  it.each(['make a mermaid flowchart for user login', 'make a mind map about machine learning', 'show my connected models and routing', 'how much has this conversation cost?'])('keeps %s out of research and images', message => {
    expect(createExecutionPlan({ message, mode: 'deep_research', reasoningEffort: 'high' })).toMatchObject({ intent: 'simple', agents: [{ role: 'general' }] });
    expect(classifyMediaIntent(message).considered).toBe(false);
  });
  it.each([['make a mermaid flowchart for user login', flow], ['make a mind map about machine learning', mind]])('preserves actual diagram output for %s', async (message, content) => {
    mock.stream.mockImplementation(() => text(content));
    const events = await turn(message);
    expect(events.filter(event => event.type === 'text_delta').map(event => event.content).join('')).toBe(content);
    expect(events.some(event => ['agent_result', 'media', 'error'].includes(event.type))).toBe(false);
    expect(mock.stream).toHaveBeenCalledTimes(1);
  });
  it('repairs flattened Mermaid before displaying it', async () => {
    mock.stream.mockImplementationOnce(() => text('mermaid flowchart TD A[Start] --> B[Login]')).mockImplementationOnce(() => text(flow));
    const events = await turn('make a mermaid flowchart for user login');
    expect(mock.stream).toHaveBeenCalledTimes(2);
    expect(events.filter(event => event.type === 'text_delta').map(event => event.content).join('')).toBe(flow);
  });
  it('writes an explanation after rendering and retains the completed diagram', async () => {
    mock.stream.mockImplementationOnce(async function* () {
      yield { id: 'test', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'diagram-1', type: 'function', function: { name: 'render_diagram', arguments: JSON.stringify({ code: 'flowchart TD\nA["Start"] --> B["Login"]' }) } }] }, finish_reason: null }] };
      yield { id: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
    }).mockImplementationOnce(() => text('Enter your username and password to sign in. The diagram shows the start of that process.'));
    const events = await turn('make a mermaid flowchart for user login');
    expect(mock.stream).toHaveBeenCalledTimes(2);
    const answer = events.filter(event => event.type === 'text_delta').map(event => event.content).join('');
    expect(answer).toContain('Enter your username and password');
    expect(answer).toContain('```mermaid\nflowchart TD\nA["Start"] --> B["Login"]\n```');
    expect(events.at(-1)?.type).toBe('done');
  });
  it('never substitutes a failed mind map with a deck, research findings or images', async () => {
    mock.stream.mockImplementation(() => text('gamma-presentation'));
    const events = await turn('make a mind map about machine learning');
    expect(mock.stream).toHaveBeenCalledTimes(2);
    expect(events.filter(event => event.type === 'text_delta')).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('complete diagram') });
  });
  it('delivers every diagram when the model renders a flowchart and a mind map together', async () => {
    mock.stream.mockImplementationOnce(async function* () {
      yield { id: 'test', choices: [{ index: 0, delta: { tool_calls: [
        { index: 0, id: 'flow', type: 'function', function: { name: 'render_diagram', arguments: JSON.stringify({ code: 'flowchart TD\nA["Wake up"] --> B["Walk"]' }) } },
        { index: 1, id: 'mind', type: 'function', function: { name: 'render_diagram', arguments: JSON.stringify({ code: 'mindmap\n  root((Weekend))\n    Food\n    Outdoors' }) } },
      ] }, finish_reason: null }] };
      yield { id: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
    }).mockImplementationOnce(() => text('Choose an activity for the weekend. The flowchart shows the order, while the mind map groups the available activities.'));
    const events = await turn('make a weekend flowchart and mind map');
    expect(mock.stream).toHaveBeenCalledTimes(2);
    expect(events.filter(event => event.type === 'tool_result')).toHaveLength(2);
    const answer = events.filter(event => event.type === 'text_delta').map(event => event.content).join('');
    expect(answer).toContain('root((Weekend))');
    expect(answer).toContain('flowchart TD');
    expect(events.at(-1)?.type).toBe('done');
  });
  it('adds a compact mind map to an implicit study roadmap while preserving study guidance', async () => {
    const content = 'Start with complexity and arrays, then practice trees, graphs and dynamic programming. Solve problems regularly and review mistakes.\n\n```mermaid\nmindmap\n  root((DSA))\n    Foundations\n      Complexity\n    Structures\n      Arrays\n    Algorithms\n      Recursion\n```';
    mock.stream.mockImplementation(() => text(content));
    const events = await turn('how can i prep dsa from begging to advanced');
    expect(events.filter(event => event.type === 'text_delta').map(event => event.content).join('')).toBe(content);
    expect(events.at(-1)?.type).toBe('done');
    expect(mock.stream.mock.calls[0][1].some((message: { content: string }) => message.content.includes('requested diagram type is mindmap'))).toBe(true);
  });
  it('honors a correction from mind map to Mermaid flowchart', async () => {
    mock.stream.mockImplementationOnce(() => text(mind)).mockImplementationOnce(() => text(flow));
    const events = await turn('mermaid diagram not mind map');
    expect(mock.stream).toHaveBeenCalledTimes(2);
    expect(events.filter(event => event.type === 'text_delta').map(event => event.content).join('')).toBe(flow);
  });
  it('repairs real Mermaid syntax errors before delivering the response', async () => {
    mock.stream.mockImplementationOnce(() => text('The process starts with a login and finishes when credentials are accepted.\n\n```mermaid\nflowchart TD\nA[Unclosed --> B\n```')).mockImplementationOnce(() => text(flow));
    const events = await turn('make a flowchart for user login');
    expect(mock.stream).toHaveBeenCalledTimes(2);
    expect(events.filter(event => event.type === 'text_delta').map(event => event.content).join('')).toBe(flow);
  });
  it('executes usage inspection without asking a model to guess', async () => {
    const events: AgentEvent[] = [];
    await withClientTools({ userId: 'owner', signal: new AbortController().signal, emit: event => {
      expect(event.name).toBe('usage_tracker');
      completeClientTool('owner', event.requestId, event.token, { content: JSON.stringify({ inputTokens: 1000, outputTokens: 500, estimatedCostUsd: .003,
        models: [{ provider: 'custom', model: 'my-model', inputTokens: 1000, outputTokens: 500, estimatedCostUsd: .003, estimated: false }] }) });
    } }, () => turn('how much has this conversation cost?', events));
    expect(events.at(-1)).toMatchObject({ type: 'done', fullText: expect.stringContaining('$0.003000 USD') });
    expect(mock.stream).not.toHaveBeenCalled();
  });
  it('inspects real routing context without exposing credentials or making a model call', async () => {
    const context: ByokContext = { userId: 'owner', mode: 'MANUAL', manualModelId: 'm1', fallbackEnabled: false, models: [{ id: 'm1', connectionId: 'c1', providerId: 'custom', modelId: 'model-a', displayName: 'My connected model', enabled: true, encryptedKey: 'SECRET', iv: 'SECRET', authTag: 'SECRET', capabilities: { text: true, vision: false, toolCalling: true, streaming: true } }] };
    const events = await withByokContext(context, () => turn('show my connected models and routing'));
    const answer = events.filter(event => event.type === 'text_delta').map(event => event.content).join('');
    expect(answer).toContain('My connected model'); expect(answer).toContain('MANUAL'); expect(answer).toContain('disabled'); expect(answer).not.toContain('SECRET');
    expect(mock.stream).not.toHaveBeenCalled();
  });
  it('distinguishes missing rates from missing records without reporting either as free', () => {
    expect(inspectionAnswer('usage_tracker', JSON.stringify({ models: [] }))).toContain('does not mean the conversation was free');
    expect(inspectionAnswer('usage_tracker', JSON.stringify({ inputTokens: 200, outputTokens: 20, estimatedCostUsd: null, models: [{ provider: 'custom', model: 'm', inputTokens: 200, outputTokens: 20, estimatedCostUsd: null }] }))).toContain('Workspace → Usage');
  });
});
