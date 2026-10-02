import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { runAgentLoop, type AgentEvent } from '../../agent/agent-loop.js';
import { withByokContext, withByokModel, type ByokModel } from '../../ai/byok-context.js';
import { resolveProvider } from '../../providers/index.js';

vi.mock('../../providers/index.js', () => ({ resolveProvider: vi.fn() }));
beforeAll(() => { process.env.ENCRYPTION_KEY = 'd'.repeat(64); initDb(':memory:'); });
beforeEach(() => vi.clearAllMocks());
function model(id: string): ByokModel {
  const key = encrypt('fixture-credential');
  return { id, connectionId: id, providerId: 'openai', modelId: id, displayName: id, encryptedKey: key.encrypted, iv: key.iv, authTag: key.authTag,
    enabled: true, capabilities: { text: true, vision: false, streaming: true, toolCalling: false } };
}
function scriptedProvider(failedModel: string) {
  return { streamChatCompletion: async function* (_key: string, _messages: unknown, modelId: string) {
    if (modelId === failedModel) throw new Error('503 Service unavailable');
    yield { choices: [{ delta: { content: 'Answer from the working backup.' }, finish_reason: 'stop' }] };
  } } as unknown as NonNullable<ReturnType<typeof resolveProvider>>;
}
describe('actual runtime routing events', () => {
  it('reports the failed primary and actual configured backup before streaming the backup answer', async () => {
    const primary = model('routing-primary'); const backup = model('routing-backup'); const unused = model('unlisted-model');
    // A native-tool-capable backup must not silently replace the user's primary
    // before that primary has even been attempted with the text-tool protocol.
    backup.capabilities.toolCalling = true;
    vi.mocked(resolveProvider).mockReturnValue(scriptedProvider(primary.id));
    const events: AgentEvent[] = [];
    await withByokContext({ userId: 'fallback-fixture', mode: 'AUTO', models: [primary, backup, unused], fallbackEnabled: true,
      execution: { version: 1, primaryModelId: primary.id, roles: [], fallbackModelIds: [backup.id] } }, () => runAgentLoop({ message: 'Say hello.', mode: 'normal', searchMode: 'off', onEvent: event => events.push(event) }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'model_route', state: 'fallback', fromModel: primary.displayName, toModel: backup.displayName, roleLabel: 'Primary' }));
    expect(events.filter(event => event.type === 'model_runtime').map(event => event.modelId)).toEqual([primary.modelId, backup.modelId]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'done', fullText: 'Answer from the working backup.', uiName: backup.displayName, connectedModelId: backup.id }));
    expect(events.findIndex(event => event.type === 'model_route')).toBeLessThan(events.findIndex(event => event.type === 'text_delta'));
  });

  it('reports unavailable primary and no routing models instead of using another catalog model', async () => {
    const primary = model('no-route-primary'); const unused = model('no-route-unlisted');
    vi.mocked(resolveProvider).mockReturnValue(scriptedProvider(primary.id));
    const events: AgentEvent[] = [];
    await withByokContext({ userId: 'exhausted-fixture', mode: 'AUTO', models: [primary, unused], fallbackEnabled: false,
      execution: { version: 1, primaryModelId: primary.id, roles: [], fallbackModelIds: [] } }, () => runAgentLoop({ message: 'Say hello.', mode: 'normal', searchMode: 'off', onEvent: event => events.push(event) }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'model_route', state: 'exhausted', message: expect.stringContaining('No routing models are configured') }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: expect.stringContaining('No routing models are configured') }));
    expect(events.some(event => event.type === 'done')).toBe(false);
    expect(events.filter(event => event.type === 'model_runtime').map(event => event.modelId)).toEqual([primary.modelId]);
  });
  it('reports a missing specialist assignment as a role fallback and never sends that work to the primary', async () => {
    const primary = model('working-primary'); const backup = model('specialist-backup');
    vi.mocked(resolveProvider).mockReturnValue(scriptedProvider('unused-failure'));
    const events: AgentEvent[] = [];
    await withByokContext({ userId: 'missing-role-fixture', mode: 'AUTO', models: [primary, backup], fallbackEnabled: true,
      execution: { version: 1, primaryModelId: primary.id, roles: [], fallbackModelIds: [backup.id] } }, () => withByokModel('unavailable-researcher', () => runAgentLoop({
        message: 'Review the supplied evidence.', mode: 'normal', searchMode: 'off', executionIdentity: { agentId: 'research', role: 'researcher', roleLabel: 'Researcher' }, onEvent: event => events.push(event),
      })));
    expect(events.filter(event => event.type === 'model_runtime').map(event => event.modelId)).toEqual([backup.modelId]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'model_route', state: 'fallback', roleLabel: 'Researcher', fromModel: 'unavailable-researcher', toModel: backup.displayName }));
  });
});
