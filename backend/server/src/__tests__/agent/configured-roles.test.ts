import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultExecutionConfig } from '@void/shared/execution-config.mjs';
const mocks = vi.hoisted(() => ({ loop: vi.fn(), media: vi.fn() }));
vi.mock('../../agent/agent-loop.js', () => ({ runAgentLoop: mocks.loop, RESPONSE_FORMATTING_POLICY: '' }));
vi.mock('../../agent/media-orchestrator.js', () => ({ runMediaWorker: mocks.media }));
import { runAdaptiveOrchestration } from '../../agent/multi-agent-orchestrator.js';
import { currentByokContext, withByokContext, type ByokContext } from '../../ai/byok-context.js';
const primary = '11111111-1111-4111-8111-111111111111', secondary = '22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  mocks.media.mockReset().mockResolvedValue([]);
  mocks.loop.mockReset().mockImplementation(async options => {
    const text = options.sessionId?.startsWith('worker-') ? JSON.stringify({ status: 'ok', summary: 'Useful evidence about the requested subject.', findings: ['A relevant finding.'], claims: [], sources: [], risks: [], confidence: .8 }) : 'The complete final answer.';
    options.onEvent({ type: 'text_delta', content: text }); options.onEvent({ type: 'done', fullText: text });
  });
});
describe('configured sequential model roles', () => {
  it('runs several roles on the same model in saved order and then uses the assigned writer', async () => {
    const sequence: string[] = []; let concurrent = 0;
    const implementation = mocks.loop.getMockImplementation()!;
    mocks.loop.mockImplementation(async options => { expect(concurrent).toBe(0); concurrent++; sequence.push(currentByokContext()?.assignedModelId || ''); await implementation(options); concurrent--; });
    const execution = { ...defaultExecutionConfig(primary), roles: [
      { id: 'research', name: 'Researcher', kind: 'researcher' as const, modelId: secondary, instruction: 'Find evidence.' },
      { id: 'check', name: 'Fact checker', kind: 'fact_checker' as const, modelId: secondary, instruction: 'Verify the research.' },
      { id: 'writer', name: 'Answer writer', kind: 'answer_writer' as const, modelId: primary, instruction: 'Explain clearly.' },
    ] };
    const events: any[] = [];
    await withByokContext({ userId: primary, mode: 'AUTO', models: [], execution } as ByokContext, () => runAdaptiveOrchestration({ message: 'Explain computer architecture', mode: 'normal', reasoningEffort: 'low', onEvent: event => events.push(event) }));
    expect(sequence).toEqual([secondary, secondary, primary]);
    expect(mocks.loop.mock.calls[1][0].systemContext).toContain('Useful evidence');
    expect(events.at(-1)).toMatchObject({ type: 'done', fullText: 'The complete final answer.' });
    expect(events.find(event => event.type === 'agent_plan').agents.map((agent: any) => agent.label)).toEqual(['Researcher', 'Fact checker', 'Answer writer']);
  });
  it('keeps the default workflow on one answer model even when several keys are connected', async () => {
    const execution = defaultExecutionConfig(primary);
    await withByokContext({ userId: primary, mode: 'AUTO', models: [], execution } as ByokContext, () => runAdaptiveOrchestration({ message: 'Explain computer architecture', mode: 'normal', reasoningEffort: 'high', maxAgents: 4, onEvent: () => {} }));
    expect(mocks.loop).toHaveBeenCalledTimes(1);
  });
});
