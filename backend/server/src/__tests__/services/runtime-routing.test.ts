import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasDb } from '../../db/index.js';
import { encrypt, initEncryptionKey } from '../../lib/crypto.js';
import { routeRequest, recordKeySuccess, clearUnavailableModels } from '../../services/router.js';
import { withByokContext, type ByokModel } from '../../ai/byok-context.js';
import { getProvider, resolveProvider } from '../../providers/index.js';
import { runAgentLoop, type AgentEvent } from '../../agent/agent-loop.js';
import { registerTool } from '../../agent/tool-registry.js';
import { OpenAICompatProvider } from '../../providers/openai-compat.js';

vi.mock('../../debug_logger.js', () => ({ logDebug: vi.fn() }));

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
  vi.stubEnv('GROQ_API_KEY', 'managed-test-credential');
  vi.stubEnv('VOID_ALLOW_FREE_CHAT', 'true');
  vi.stubEnv('VOID_MANAGED_GROQ_MODEL', 'configured-managed-model');
  initEncryptionKey();
  clearUnavailableModels();
});
afterEach(() => vi.unstubAllEnvs());

describe('agent routing without a local key pool', () => {
  it('routes managed text/tool calls and records success without initializing SQLite', () => {
    expect(hasDb()).toBe(false);
    const route = routeRequest(100, undefined, undefined, false, true);
    expect(route.modelId).toBe('configured-managed-model');
    expect(route.apiKey).toBe('managed-test-credential');
    expect(route.supportsTools).toBe(true);
    expect(() => recordKeySuccess(route.keyId)).not.toThrow();
    expect(hasDb()).toBe(false);
  });

  it('returns configuration and capability errors instead of database errors', () => {
    expect(() => routeRequest(100, undefined, undefined, true)).toThrow(/compatible/);
    expect(() => routeRequest(100, undefined, undefined, false, false, new Set(['different-model']))).toThrow(/compatible/);
    expect(() => routeRequest(100, new Set(['groq:configured-managed-model:*']))).toThrow(/temporarily unavailable/);
    vi.stubEnv('GROQ_API_KEY', '');
    expect(() => routeRequest()).toThrow(/Connect an AI provider/);
  });

  it('honors the managed resource opt-out', () => {
    vi.stubEnv('VOID_ALLOW_FREE_CHAT', 'false');
    expect(() => routeRequest()).toThrow(/Connect an AI provider/);
  });

  it('keeps BYOK selection and failures inside the user context', async () => {
    const credential = encrypt('private-user-credential');
    const model: ByokModel = { id: 'user-model', connectionId: 'user-connection', providerId: 'openai',
      modelId: 'user-model', displayName: 'User model', encryptedKey: credential.encrypted,
      iv: credential.iv, authTag: credential.authTag, enabled: true,
      capabilities: { text: true, vision: false, toolCalling: true, streaming: true } };
    const context = { userId: 'user-a', mode: 'AUTO' as const, models: [model] };
    await withByokContext(context, async () => {
      const route = routeRequest();
      expect(route.apiKey).toBe('private-user-credential');
      expect(() => recordKeySuccess(route.keyId)).not.toThrow();
    });
    await expect(withByokContext({ ...context, models: [] }, async () => routeRequest())).rejects.toThrow(/compatible/);
    expect(hasDb()).toBe(false);
  });

  it('executes a tool, feeds its result back, and streams the final answer without SQLite', async () => {
    const handler = vi.fn(async () => ({ content: '4' }));
    registerTool('calculator', { type: 'function', function: { name: 'calculator', description: 'Calculate an expression',
      parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } } },
    handler, { requiresConfirmation: false, readOnly: true, category: 'data' });
    const provider = getProvider('groq')!;
    const stream = vi.spyOn(provider, 'streamChatCompletion').mockImplementation(async function* (_key, messages, modelId) {
      const hasResult = messages.some(message => message.role === 'tool' && message.content === '4');
      yield { id: 'test-completion', object: 'chat.completion.chunk', created: 0, model: modelId,
        choices: [{ index: 0, delta: hasResult ? { content: 'The answer is 4.' } : {
          tool_calls: [{ id: 'calculator-call', type: 'function', function: { name: 'calculator', arguments: '{"expression":"2+2"}' } }],
        }, finish_reason: hasResult ? 'stop' : 'tool_calls' }] };
    });
    const events: AgentEvent[] = [];
    await runAgentLoop({ message: 'Calculate 2+2', mode: 'normal', searchMode: 'off',
      allowedTools: ['calculator'], maxIterations: 3, onEvent: event => events.push(event) });
    expect(handler).toHaveBeenCalledWith({ expression: '2+2' });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual({ type: 'tool_result', callId: 'calculator-call', content: '4', error: undefined });
    expect(events).toContainEqual({ type: 'done', fullText: 'The answer is 4.' });
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(hasDb()).toBe(false);
  });

  it('executes the screenshot text-form search and continues to a real answer', async () => {
    const handler = vi.fn(async () => ({ content: 'Verified Shisui search results.' }));
    registerTool('web_search', { type: 'function', function: { name: 'web_search', description: 'Search the web',
      parameters: { type: 'object', properties: { query: { type: 'string' }, includeImages: { type: 'boolean' }, maxResults: { type: 'number' }, searchDepth: { type: 'string' } }, required: ['query'] } } },
    handler, { requiresConfirmation: false, readOnly: true, category: 'retrieval' });
    const textCall = '<tool_call> <function=web_search> <parameter=includeImages> false </parameter> <parameter=maxResults> 10.0 </parameter> <parameter=query> Shisui Uchiha Kotoamatsukami Kamui jutsu </parameter> <parameter=searchDepth> advanced </parameter> </function> </tool_call>';
    const provider = getProvider('groq')!;
    const stream = vi.spyOn(provider, 'streamChatCompletion').mockImplementation(async function* (_key, messages, modelId) {
      const hasResult = messages.some(message => message.role === 'tool');
      const content = hasResult ? 'Shisui Uchiha is known for Kotoamatsukami.' : textCall;
      for (let offset = 0; offset < content.length; offset += 4) {
        yield { id: 'text-call-test', object: 'chat.completion.chunk', created: 0, model: modelId,
          choices: [{ index: 0, delta: { content: content.slice(offset, offset + 4) }, finish_reason: null }] };
      }
      yield { id: 'text-call-test', object: 'chat.completion.chunk', created: 0, model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    });
    const events: AgentEvent[] = [];
    await runAgentLoop({ message: 'Who is Shisui? Explain his jutsu.', mode: 'normal', searchMode: 'advanced',
      allowedTools: ['web_search'], maxIterations: 3, onEvent: event => events.push(event) });
    expect(handler).toHaveBeenCalledWith({ includeImages: false, maxResults: 10,
      query: 'Shisui Uchiha Kotoamatsukami Kamui jutsu', searchDepth: 'advanced' });
    expect(stream).toHaveBeenCalledTimes(2);
    const text = events.filter((event): event is Extract<AgentEvent, { type: 'text_delta' }> => event.type === 'text_delta').map(event => event.content).join('');
    expect(text).toBe('Shisui Uchiha is known for Kotoamatsukami.');
    expect(events).toContainEqual({ type: 'done', fullText: text });
    expect(events).toContainEqual({ type: 'progress', action: 'Preparing the answer from the results' });
    expect(events.some(event => event.type === 'error')).toBe(false);
  });

  it('keeps the write confirmation gate for recovered calls', async () => {
    const handler = vi.fn(async () => ({ content: 'saved' }));
    registerTool('file_write', { type: 'function', function: { name: 'file_write', parameters: { type: 'object',
      properties: { filepath: { type: 'string' }, content: { type: 'string' } }, required: ['filepath', 'content'] } } },
    handler, { requiresConfirmation: true, readOnly: false, category: 'file' });
    vi.spyOn(getProvider('groq')!, 'streamChatCompletion').mockImplementation(async function* (_key, _messages, modelId) {
      yield { id: 'confirmation-test', object: 'chat.completion.chunk', created: 0, model: modelId,
        choices: [{ index: 0, delta: { content: '<tool_call><function=file_write><parameter=filepath>example.txt</parameter><parameter=content>hello</parameter></function></tool_call>' }, finish_reason: 'stop' }] };
    });
    const events: AgentEvent[] = [];
    await runAgentLoop({ message: 'Save hello in a file', mode: 'normal', searchMode: 'off', allowedTools: ['file_write'],
      onEvent: event => events.push(event) });
    expect(handler).not.toHaveBeenCalled();
    expect(events.some(event => event.type === 'confirmation_required')).toBe(true);
    expect(events.some(event => event.type === 'text_delta')).toBe(false);
  });

  it.each(['text', 'native'])('rejects %s calls to tools outside the allowed role', async transport => {
    const handler = vi.fn(async () => ({ content: 'never' }));
    registerTool('file_write', { type: 'function', function: { name: 'file_write', parameters: { type: 'object', properties: {} } } },
      handler, { requiresConfirmation: false, readOnly: false, category: 'file' });
    vi.spyOn(getProvider('groq')!, 'streamChatCompletion').mockImplementation(async function* (_key, _messages, modelId) {
      yield { id: 'unavailable-test', object: 'chat.completion.chunk', created: 0, model: modelId,
        choices: [{ index: 0, delta: transport === 'text' ? { content: '<tool_call><function=file_write></function></tool_call>' }
          : { tool_calls: [{ id: 'denied-native', type: 'function', function: { name: 'file_write', arguments: '{}' } }] }, finish_reason: 'stop' }] };
    });
    const events: AgentEvent[] = [];
    await runAgentLoop({ message: 'Review this question', mode: 'normal', searchMode: 'off', allowedTools: ['calculator'],
      onEvent: event => events.push(event) });
    expect(handler).not.toHaveBeenCalled();
    expect(events.some(event => event.type === 'text_delta' || event.type === 'tool_call')).toBe(false);
    expect(events.some(event => event.type === 'error')).toBe(true);
  });

  it.each(['openai', 'anthropic', 'google', 'groq', 'mistral', 'openrouter', 'custom'])('executes fenced JSON through the shared %s provider path and returns only a final answer', async providerId => {
    const handler = vi.fn(async () => ({ content: '4' }));
    registerTool('calculator', { type: 'function', function: { name: 'calculator', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } } }, handler,
      { requiresConfirmation: false, readOnly: true, category: 'data' });
    const credential = encrypt('isolated-provider-key');
    const baseUrl = providerId === 'custom' ? 'https://custom.example.test/v1' : undefined;
    const provider = resolveProvider(providerId as any, baseUrl, true)!;
    const stream = vi.spyOn(providerId === 'custom' ? OpenAICompatProvider.prototype : provider, 'streamChatCompletion').mockImplementation(async function* (_key, messages, modelId, options) {
      const finished = messages.some(message => message.role === 'tool' && message.content === '4'
        || message.role === 'user' && typeof message.content === 'string' && message.content.includes('[Runtime tool result') && message.content.includes('\n4\n'));
      if (providerId === 'custom') {
        expect(options?.tools).toBeUndefined(); expect(messages.every(message => message.role !== 'tool' && !message.tool_calls)).toBe(true);
        expect(messages.some(message => typeof message.content === 'string' && message.content.includes('Available tool schemas:') && message.content.includes('expression'))).toBe(true);
      }
      const content = finished ? 'The answer is 4.' : '```json\n{"type":"calculator","expression":"2+2"}\n```';
      for (const character of content) yield { id: 'provider-protocol-test', object: 'chat.completion.chunk', created: 0, model: modelId,
        choices: [{ index: 0, delta: { content: character }, finish_reason: null }] };
    });
    const events: AgentEvent[] = [];
    await withByokContext({ userId: `provider-${providerId}`, mode: 'AUTO', models: [{ id: `model-${providerId}`, connectionId: `connection-${providerId}`, providerId,
      modelId: 'compatible-chat-model', displayName: 'Connected model', baseUrl, encryptedKey: credential.encrypted, iv: credential.iv, authTag: credential.authTag,
      enabled: true, capabilities: { text: true, streaming: true, vision: false, toolCalling: providerId !== 'custom' } }] }, () => runAgentLoop({ message: 'Calculate 2+2', mode: 'normal', searchMode: 'off',
        allowedTools: ['calculator'], maxIterations: 3, onEvent: event => events.push(event) }));
    expect(handler).toHaveBeenCalledTimes(1); expect(stream).toHaveBeenCalledTimes(2);
    const visible = events.filter((event): event is Extract<AgentEvent, { type: 'text_delta' }> => event.type === 'text_delta').map(event => event.content).join('');
    expect(visible).toBe('The answer is 4.'); expect(events).toContainEqual({ type: 'done', fullText: visible });
  });

  it('retries a custom API once without native tools when the API rejects them', async () => {
    const handler = vi.fn(async () => ({ content: '4' }));
    registerTool('calculator', { type: 'function', function: { name: 'calculator', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } } }, handler,
      { requiresConfirmation: false, readOnly: true, category: 'data' });
    const credential = encrypt('isolated-custom-key'); const baseUrl = 'https://compatibility.example.test/v1';
    const provider = resolveProvider('custom' as any, baseUrl, true)!;
    const stream = vi.spyOn(OpenAICompatProvider.prototype, 'streamChatCompletion').mockImplementation(async function* (_key, messages, modelId, options) {
      if (options?.tools) throw new Error('400 This model does not support tools');
      const finished = messages.some(message => typeof message.content === 'string' && message.content.includes('[Runtime tool result'));
      yield { id: 'compatibility-test', object: 'chat.completion.chunk', created: 0, model: modelId,
        choices: [{ index: 0, delta: { content: finished ? 'The answer is 4.' : '{"tool":"calculator","arguments":{"expression":"2+2"}}' }, finish_reason: 'stop' }] };
    });
    const events: AgentEvent[] = [];
    await withByokContext({ userId: 'custom-compatibility', mode: 'AUTO', fallbackEnabled: false, models: [{ id: 'compat-model', connectionId: 'compat-connection', providerId: 'custom', modelId: 'compat-model', displayName: 'Custom model', baseUrl,
      encryptedKey: credential.encrypted, iv: credential.iv, authTag: credential.authTag, enabled: true, capabilities: { text: true, streaming: true, vision: false, toolCalling: true } }] }, () => runAgentLoop({ message: 'Calculate 2+2', mode: 'normal', searchMode: 'off', allowedTools: ['calculator'],
        maxProviderAttempts: 1, maxIterations: 3, onEvent: event => events.push(event) }));
    expect(stream).toHaveBeenCalledTimes(3); expect(handler).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: 'done', fullText: 'The answer is 4.' });
    expect(events.some(event => event.type === 'error')).toBe(false);
  });

  it('returns invalid arguments to the model for repair before executing a handler', async () => {
    const handler = vi.fn(async () => ({ content: '4' }));
    registerTool('calculator', { type: 'function', function: { name: 'calculator', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } } }, handler,
      { requiresConfirmation: false, readOnly: true, category: 'data' });
    vi.spyOn(getProvider('groq')!, 'streamChatCompletion').mockImplementation(async function* (_key, messages, modelId) {
      const fixed = messages.some(message => message.role === 'tool' && message.content === '4');
      const error = messages.some(message => message.role === 'tool' && String(message.content).includes('do not match the schema'));
      yield { id: 'arguments-test', object: 'chat.completion.chunk', created: 0, model: modelId,
        choices: [{ index: 0, delta: { content: fixed ? 'The answer is 4.' : error ? '{"type":"calculator","expression":"2+2"}' : '{"type":"calculator","expression":25}' }, finish_reason: 'stop' }] };
    });
    const events: AgentEvent[] = [];
    await runAgentLoop({ message: 'Calculate 2+2', mode: 'normal', searchMode: 'off', allowedTools: ['calculator'], maxIterations: 4, onEvent: event => events.push(event) });
    expect(handler).toHaveBeenCalledTimes(1); expect(handler).toHaveBeenCalledWith({ expression: '2+2' });
    expect(events).toContainEqual({ type: 'done', fullText: 'The answer is 4.' });
  });

  it('advertises a newly discovered skill schema before invoking its handler', async () => {
    const handler = vi.fn(async () => ({ content: 'Verified document summary.' }));
    registerTool('future_skill', { type: 'function', function: { name: 'future_skill', description: 'Summarize a document', parameters: { type: 'object', properties: { document: { type: 'string' } }, required: ['document'] } } }, handler,
      { requiresConfirmation: false, readOnly: true, category: 'data' });
    registerTool('tool_search', { type: 'function', function: { name: 'tool_search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }, async () => ({ content: 'future_skill is available.', availableTools: ['future_skill'] }),
      { requiresConfirmation: false, readOnly: true, category: 'meta' });
    vi.spyOn(getProvider('groq')!, 'streamChatCompletion').mockImplementation(async function* (_key, messages, modelId, options) {
      const found = messages.some(message => message.role === 'tool' && message.content === 'future_skill is available.');
      const finished = messages.some(message => message.role === 'tool' && message.content === 'Verified document summary.');
      if (found && !finished) expect((options?.tools as any[])?.some(schema => schema.function.name === 'future_skill')).toBe(true);
      yield { id: 'discovery-test', object: 'chat.completion.chunk', created: 0, model: modelId,
        choices: [{ index: 0, delta: { content: finished ? 'Here is the verified document summary.' : found ? '{"type":"future_skill","document":"one"}' : '{"tool":"tool_search","arguments":{"query":"summarize"}}' }, finish_reason: 'stop' }] };
    });
    const events: AgentEvent[] = [];
    await runAgentLoop({ message: 'Find the right tool to summarize this document', mode: 'normal', searchMode: 'off', allowedTools: ['tool_search', 'future_skill'], maxIterations: 4, onEvent: event => events.push(event) });
    expect(handler).toHaveBeenCalledWith({ document: 'one' });
    expect(events).toContainEqual({ type: 'done', fullText: 'Here is the verified document summary.' });
  });

  it('reuses a repeated successful read and asks for the final answer instead of looping on tools', async () => {
    const handler = vi.fn(async () => ({ content: '4' }));
    registerTool('calculator', { type: 'function', function: { name: 'calculator', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } } }, handler,
      { requiresConfirmation: false, readOnly: true, category: 'data' });
    const stream = vi.spyOn(getProvider('groq')!, 'streamChatCompletion').mockImplementation(async function* (_key, _messages, modelId, options) {
      yield { id: 'repeat-test', object: 'chat.completion.chunk', created: 0, model: modelId,
        choices: [{ index: 0, delta: { content: options?.tools ? '{"tool":"calculator","arguments":{"expression":"2+2"}}' : 'The answer is 4.' }, finish_reason: 'stop' }] };
    });
    const events: AgentEvent[] = [];
    await runAgentLoop({ message: 'Calculate 2+2', mode: 'normal', searchMode: 'off', allowedTools: ['calculator'], maxIterations: 8, onEvent: event => events.push(event) });
    expect(handler).toHaveBeenCalledTimes(1); expect(stream).toHaveBeenCalledTimes(3);
    expect(events).toContainEqual({ type: 'done', fullText: 'The answer is 4.' });
  });

  it('does not reuse results for different nested arguments', async () => {
    const handler = vi.fn(async (args: Record<string, unknown>) => ({ content: String((args.expression as { a: number; b: number }).a + (args.expression as { a: number; b: number }).b) }));
    registerTool('calculator', { type: 'function', function: { name: 'calculator', parameters: { type: 'object', properties: { expression: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } }, required: ['expression'] } } }, handler,
      { requiresConfirmation: false, readOnly: true, category: 'data' });
    vi.spyOn(getProvider('groq')!, 'streamChatCompletion').mockImplementation(async function* (_key, messages, modelId) {
      const first = messages.some(message => message.role === 'tool' && message.content === '3');
      const second = messages.some(message => message.role === 'tool' && message.content === '7');
      yield { id: 'nested-arguments-test', object: 'chat.completion.chunk', created: 0, model: modelId,
        choices: [{ index: 0, delta: { content: second ? 'The results are 3 and 7.' : first ? '{"tool":"calculator","arguments":{"expression":{"a":3,"b":4}}}' : '{"tool":"calculator","arguments":{"expression":{"a":1,"b":2}}}' }, finish_reason: 'stop' }] };
    });
    const events: AgentEvent[] = [];
    await runAgentLoop({ message: 'Calculate both totals', mode: 'normal', searchMode: 'off', allowedTools: ['calculator'], maxIterations: 4, onEvent: event => events.push(event) });
    expect(handler).toHaveBeenCalledTimes(2); expect(events).toContainEqual({ type: 'done', fullText: 'The results are 3 and 7.' });
  });

  it('does not use text transport to bypass a user-disabled tools setting', async () => {
    const handler = vi.fn(async () => ({ content: 'never' }));
    registerTool('calculator', { type: 'function', function: { name: 'calculator', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } } }, handler,
      { requiresConfirmation: false, readOnly: true, category: 'data' });
    const credential = encrypt('tools-disabled-key'); const baseUrl = 'https://disabled.example.test/v1';
    vi.spyOn(OpenAICompatProvider.prototype, 'streamChatCompletion').mockImplementation(async function* (_key, messages, modelId, options) {
      expect(options?.tools).toBeUndefined();
      expect(messages.some(message => typeof message.content === 'string' && message.content.includes('Available tool schemas:'))).toBe(false);
      yield { id: 'disabled-tools-test', object: 'chat.completion.chunk', created: 0, model: modelId,
        choices: [{ index: 0, delta: { content: '{"tool":"calculator","arguments":{"expression":"2+2"}}' }, finish_reason: 'stop' }] };
    });
    const events: AgentEvent[] = [];
    await withByokContext({ userId: 'tools-disabled', mode: 'AUTO', fallbackEnabled: false, models: [{ id: 'disabled-model', connectionId: 'disabled-connection', providerId: 'custom', modelId: 'disabled-model', displayName: 'Disabled tools model', baseUrl,
      encryptedKey: credential.encrypted, iv: credential.iv, authTag: credential.authTag, enabled: true, toolsEnabled: false,
      capabilities: { text: true, streaming: true, vision: false, toolCalling: false } }] }, () => runAgentLoop({ message: 'Calculate 2+2', mode: 'normal', searchMode: 'off', allowedTools: ['calculator'], maxProviderAttempts: 1,
        onEvent: event => events.push(event) }));
    expect(handler).not.toHaveBeenCalled(); expect(events.some(event => event.type === 'tool_call' || event.type === 'text_delta')).toBe(false);
  });
});
