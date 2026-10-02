import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentByokContext, withByokContext, type ByokContext } from '../../ai/byok-context.js';
import { runAdaptiveOrchestration } from '../../agent/multi-agent-orchestrator.js';
import { runAgentLoop, type AgentEvent } from '../../agent/agent-loop.js';

vi.mock('../../agent/agent-loop.js', () => ({ runAgentLoop: vi.fn(), RESPONSE_FORMATTING_POLICY: '' }));
vi.mock('../../agent/media-orchestrator.js', () => ({ runMediaWorker: vi.fn(async () => []) }));

const report = { status: 'ok', summary: 'Validated requirements and evidence for the request.', findings: ['Useful role-specific evidence.'], claims: [], sources: [], risks: [], confidence: .8 };
const assignments = [{ roleId: 'research', task: 'Find reliable telescope accessibility specifications.' }, { roleId: 'analyse', task: 'Compare the reported accessibility specifications.' }, { roleId: 'review', task: 'Check the controls for accessibility barriers.' }];
const config = { version: 1 as const, primaryModelId: 'primary-model', fallbackModelIds: [], roles: [
  { id: 'research', kind: 'researcher' as const, name: 'Researcher', modelId: 'research-model', instruction: '' },
  { id: 'analyse', kind: 'analyst' as const, name: 'Analyst', modelId: 'analysis-model', instruction: '' },
  { id: 'review', kind: 'custom' as const, name: 'Accessibility reviewer', modelId: 'review-model', instruction: 'Check accessibility constraints.' },
  { id: 'write', kind: 'answer_writer' as const, name: 'Answer writer', modelId: 'writer-model', instruction: '' },
] };
const context: ByokContext = { userId: 'test-user', mode: 'AUTO', models: [], execution: config };

beforeEach(() => vi.clearAllMocks());
describe('configured orchestration execution', () => {
  it('calls the primary, every assigned role, and the writer with their own model, retaining custom identity and earlier evidence', async () => {
    const executed: string[] = [];
    const events: AgentEvent[] = [];
    vi.mocked(runAgentLoop).mockImplementation(async options => {
      executed.push(currentByokContext()!.assignedModelId!);
      const identity = options.executionIdentity!;
      options.onEvent({ ...identity, type: 'model_runtime', uiName: currentByokContext()!.assignedModelId!, modelId: currentByokContext()!.assignedModelId!, platform: 'test', attempt: 0, reason: 'selected' });
      const text = identity.agentId === 'write' ? 'Final answer based on the completed team reports.' : JSON.stringify(identity.agentId === 'primary' ? { ...report, assignments } : report);
      options.onEvent({ type: 'text_delta', content: text });
      options.onEvent({ type: 'done', fullText: text });
    });
    await withByokContext(context, () => runAdaptiveOrchestration({ message: 'Compare accessible telescope designs.', mode: 'normal', allowedTools: ['web_search', 'web_fetch', 'calculator', 'file_read', 'generate_pdf'], onEvent: event => events.push(event) }));
    expect(executed).toEqual(['primary-model', 'research-model', 'analysis-model', 'review-model', 'writer-model']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'model_runtime', agentId: 'review', role: 'custom', roleLabel: 'Accessibility reviewer', uiName: 'review-model' }));
    expect(events.filter(event => event.type === 'text_delta').map(event => event.content).join('')).toBe('Final answer based on the completed team reports.');
    expect(vi.mocked(runAgentLoop).mock.calls.at(-1)![0].systemContext).toContain(report.summary);
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent_status', agentId: 'write', uiName: 'writer-model', status: 'completed' }));
    const calls = vi.mocked(runAgentLoop).mock.calls.map(([options]) => options);
    expect(calls[0].allowedTools).toEqual([]);
    expect(calls[0].systemContext).toContain('Do not research, calculate, verify facts, or write the answer yourself');
    expect(calls[1].allowedTools).toEqual(['web_search', 'web_fetch']);
    expect(calls[1].executionIdentity?.target).toBe(assignments[0].task);
    expect(calls[2].allowedTools).toEqual(['calculator', 'file_read']);
    expect(calls[2].systemContext).toContain(assignments[1].task);
    expect(calls[2].systemContext).toContain(report.summary);
    expect(calls[3].systemContext).toContain(assignments[2].task);
    expect(calls.at(-1)?.allowedTools).toEqual(['generate_pdf']);
  });

  it('uses configured roles for grounded attachments while preserving the attachment in each stage', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async options => {
      const text = options.executionIdentity?.agentId === 'write' ? 'Grounded answer.' : JSON.stringify(report);
      options.onEvent({ type: 'text_delta', content: text }); options.onEvent({ type: 'done', fullText: text });
    });
    const attachment = { name: 'notes.txt', type: 'text/plain', url: 'https://example.com/notes.txt', extractedText: 'Telescope requirements from the uploaded notes.' };
    await withByokContext(context, () => runAdaptiveOrchestration({ message: 'Analyse these uploaded notes.', attachments: [attachment], mode: 'normal', onEvent: () => {} }));
    expect(runAgentLoop).toHaveBeenCalledTimes(5);
    expect(vi.mocked(runAgentLoop).mock.calls.every(([options]) => options.attachments?.[0] === attachment)).toBe(true);
  });

  it('runs fact checking on its assigned model and labels primary reuse as answer writing when there is no separate writer', async () => {
    const executed: Array<{ model?: string; role?: string }> = [];
    const events: AgentEvent[] = [];
    vi.mocked(runAgentLoop).mockImplementation(async options => {
      executed.push({ model: currentByokContext()?.assignedModelId, role: options.executionIdentity?.role });
      const text = options.executionIdentity?.role === 'answer_writer' ? 'Synthesized specialist answer.' : JSON.stringify(report);
      options.onEvent({ type: 'text_delta', content: text }); options.onEvent({ type: 'done', fullText: text });
    });
    const roles = [...config.roles.filter(role => role.kind !== 'answer_writer'), { id: 'verify', kind: 'fact_checker' as const, name: 'Fact checker', modelId: 'fact-model', instruction: '' }];
    await withByokContext({ ...context, execution: { ...config, roles } }, () => runAdaptiveOrchestration({ message: 'Compare telescope specifications.', mode: 'normal', onEvent: event => events.push(event) }));
    expect(executed).toEqual([{ model: 'primary-model', role: 'primary' }, { model: 'research-model', role: 'researcher' },
      { model: 'analysis-model', role: 'analyst' }, { model: 'review-model', role: 'custom' }, { model: 'fact-model', role: 'fact_checker' },
      { model: 'primary-model', role: 'answer_writer' }]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent_status', role: 'answer_writer', roleLabel: 'Answer writer', status: 'completed' }));
  });

  it('stops with the primary failure when no configured route works', async () => {
    const events: AgentEvent[] = [];
    vi.mocked(runAgentLoop).mockImplementation(async options => {
      options.onEvent({ ...options.executionIdentity, type: 'model_route', state: 'exhausted', fromModel: 'Primary model', message: 'Primary model unavailable. No routing models are configured.' });
      options.onEvent({ type: 'error', message: 'Primary model unavailable. No routing models are configured.' });
    });
    await withByokContext(context, () => runAdaptiveOrchestration({ message: 'Compare telescope designs.', mode: 'normal', onEvent: event => events.push(event) }));
    expect(runAgentLoop).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: 'Primary model unavailable. No routing models are configured.' }));
    expect(events.some(event => event.type === 'done')).toBe(false);
  });
});
