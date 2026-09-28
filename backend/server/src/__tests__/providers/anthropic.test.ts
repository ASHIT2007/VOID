import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../../providers/anthropic.js';

describe('Anthropic adapter', () => {
  it('preserves provider-reported streamed token counts', async () => {
    const events = [{ type: 'message_start', message: { usage: { input_tokens: 32 } } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }];
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')));
    try { const chunks = []; for await (const item of new AnthropicProvider().streamChatCompletion('key', [{ role: 'user', content: 'Hi' }], 'model')) chunks.push(item);
      expect(chunks.find(item => item.usage)?.usage).toEqual({ prompt_tokens: 32, completion_tokens: 7, total_tokens: 39 });
    } finally { mock.mockRestore(); }
  });
  it('normalizes tool calls and never puts the key in the request body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'msg_1', content: [{ type: 'text', text: 'Done' }, { type: 'tool_use', id: 'tool_1', name: 'search', input: { q: 'VOID' } }],
      stop_reason: 'tool_use', usage: { input_tokens: 12, output_tokens: 8 },
    }), { status: 200 }));
    try {
      const result = await new AnthropicProvider().chatCompletion('private-key', [{ role: 'user', content: 'Search' }], 'claude-test',
        { tools: [{ type: 'function', function: { name: 'search', parameters: { type: 'object', properties: {} } } }] });
      expect(result.choices[0].message.tool_calls?.[0].function.name).toBe('search');
      expect(result.usage.total_tokens).toBe(20);
      expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'x-api-key': 'private-key' });
      expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain('private-key');
    } finally { fetchMock.mockRestore(); }
  });

  it('normalizes streamed text and incremental tool arguments', async () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'search' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"q":"VOID"}' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Working' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    ];
    const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(body, { status: 200 }));
    try {
      const chunks = [];
      for await (const chunk of new AnthropicProvider().streamChatCompletion('key', [{ role: 'user', content: 'Search' }], 'claude-test')) chunks.push(chunk);
      expect(chunks.map(chunk => chunk.choices[0].delta.content).filter(Boolean)).toEqual(['Working']);
      expect(chunks[1].choices[0].delta.tool_calls?.[0].function.arguments).toBe('{"q":"VOID"}');
      expect(chunks.at(-1)?.choices[0].finish_reason).toBe('tool_calls');
    } finally { fetchMock.mockRestore(); }
  });
});
