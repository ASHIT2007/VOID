import type { ChatMessage, ChatCompletionChunk, ChatCompletionResponse, ChatToolCall } from '@void/shared/types.js';
import { BaseProvider, type CompletionOptions } from './base.js';
import { contentToString } from '../lib/content.js';
import { safePublicFetch } from '@void/shared/safe-fetch.mjs';

const API = 'https://api.anthropic.com/v1';

async function imageBlock(block: unknown): Promise<unknown> {
  const item = block as { image_url?: string | { url?: string }; data?: string; mime_type?: string };
  const url = typeof item.image_url === 'string' ? item.image_url : item.image_url?.url;
  if (!url) throw new Error('The attached image could not be read');
  const data = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(url);
  if (data) {
    if (data[2].length > 11_000_000) throw new Error('The attached image is too large');
    return { type: 'image', source: { type: 'base64', media_type: data[1], data: data[2] } };
  }
  const response = await safePublicFetch(url, { maxBytes: 8 * 1024 * 1024, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('The attached image could not be loaded');
  const mediaType = response.headers.get('content-type')?.split(';')[0];
  if (!mediaType || !/^image\/(?:png|jpeg|webp|gif)$/.test(mediaType)) throw new Error('Unsupported image format');
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(await response.arrayBuffer()).toString('base64') } };
}

async function payload(messages: ChatMessage[], model: string, options?: CompletionOptions, stream = false) {
  const system = messages.filter(message => message.role === 'system').map(message => contentToString(message.content)).join('\n');
  const turns: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      turns.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: contentToString(message.content) }] });
    } else if (message.role === 'assistant' && message.tool_calls?.length) {
      turns.push({ role: 'assistant', content: [
        ...(contentToString(message.content) ? [{ type: 'text', text: contentToString(message.content) }] : []),
        ...message.tool_calls.map(call => ({ type: 'tool_use', id: call.id, name: call.function.name,
          input: JSON.parse(call.function.arguments || '{}') as unknown })),
      ] });
    } else {
      if (message.role === 'user' && Array.isArray(message.content)) {
        const content: unknown[] = [];
        for (const block of message.content) {
          if (typeof block === 'string') content.push({ type: 'text', text: block });
          else if (block.type === 'image_url' || block.type === 'image') content.push(await imageBlock(block));
          else if (typeof block.text === 'string') content.push({ type: 'text', text: block.text });
        }
        turns.push({ role: 'user', content });
      } else turns.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: contentToString(message.content) });
    }
  }
  return { model, system: system || undefined, messages: turns, max_tokens: options?.max_tokens ?? 4096,
    temperature: options?.temperature, stream,
    tools: options?.tools?.map(tool => ({ name: tool.function.name, description: tool.function.description,
      input_schema: tool.function.parameters ?? { type: 'object', properties: {} } })),
    tool_choice: options?.tool_choice === 'none' ? { type: 'none' } : options?.tool_choice === 'required' ? { type: 'any' } : undefined };
}

function headers(key: string) { return { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }; }
function providerError(status: number): Error {
  const error = new Error(`Anthropic API error ${status}`) as Error & { status?: number };
  error.status = status;
  return error;
}

export class AnthropicProvider extends BaseProvider {
  readonly platform = 'anthropic' as const;
  readonly name = 'Anthropic';

  async validateKey(apiKey: string): Promise<boolean> {
    const res = await this.fetchWithTimeout(`${API}/models?limit=1`, { headers: headers(apiKey) }, 15000);
    return res.ok;
  }

  async chatCompletion(apiKey: string, messages: ChatMessage[], modelId: string, options?: CompletionOptions): Promise<ChatCompletionResponse> {
    const res = await this.fetchWithTimeout(`${API}/messages`, { method: 'POST', headers: headers(apiKey),
      body: JSON.stringify(await payload(messages, modelId, options)), signal: options?.signal }, 120000);
    if (!res.ok) throw providerError(res.status);
    const data = await res.json() as { id: string; content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    const toolCalls: ChatToolCall[] = data.content.filter(block => block.type === 'tool_use').map(block => ({
      id: block.id || crypto.randomUUID(), type: 'function', function: { name: block.name || '', arguments: JSON.stringify(block.input ?? {}) },
    }));
    const input = data.usage?.input_tokens ?? 0, output = data.usage?.output_tokens ?? 0;
    return { id: data.id, object: 'chat.completion', created: Date.now() / 1000 | 0, model: modelId,
      choices: [{ index: 0, message: { role: 'assistant', content: data.content.filter(block => block.type === 'text').map(block => block.text || '').join(''),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length ? 'tool_calls' : data.stop_reason === 'max_tokens' ? 'length' : 'stop' }],
      usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output }, _routed_via: { platform: this.platform, model: modelId } };
  }

  async *streamChatCompletion(apiKey: string, messages: ChatMessage[], modelId: string, options?: CompletionOptions): AsyncGenerator<ChatCompletionChunk> {
    const res = await this.fetchWithTimeout(`${API}/messages`, { method: 'POST', headers: headers(apiKey),
      body: JSON.stringify(await payload(messages, modelId, options, true)), signal: options?.signal }, 120000);
    if (!res.ok) throw providerError(res.status);
    if (!res.body) throw new Error('Anthropic returned no response body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const id = crypto.randomUUID();
    let buffer = '';
    let inputTokens: number | undefined;
    const chunk = (delta: ChatCompletionChunk['choices'][number]['delta'], finish_reason: string | null = null): ChatCompletionChunk => ({
      id, object: 'chat.completion.chunk', created: Date.now() / 1000 | 0, model: modelId,
      choices: [{ index: 0, delta, finish_reason }],
    });
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const records = buffer.split(/\r?\n\r?\n/);
        buffer = records.pop() || '';
        for (const record of records) {
          const line = record.split(/\r?\n/).find(part => part.startsWith('data: '));
          if (!line) continue;
          let event: { type?: string; index?: number; message?: { usage?: { input_tokens?: number } }; usage?: { output_tokens?: number }; content_block?: { type?: string; id?: string; name?: string }; delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string } };
          try { event = JSON.parse(line.slice(6)); } catch { continue; }
          if (event.type === 'error') throw new Error('Anthropic stream failed');
          if (event.type === 'message_start') inputTokens = event.message?.usage?.input_tokens;
          if (event.type === 'message_delta' && Number.isFinite(inputTokens) && Number.isFinite(event.usage?.output_tokens)) {
            yield { ...chunk({}), choices: [], usage: { prompt_tokens: inputTokens!, completion_tokens: event.usage!.output_tokens!, total_tokens: inputTokens! + event.usage!.output_tokens! } };
          }
          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            yield chunk({ tool_calls: [{ id: event.content_block.id || crypto.randomUUID(), type: 'function',
              function: { name: event.content_block.name || '', arguments: '' }, index: event.index ?? 0 } as ChatToolCall] });
          } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
            yield chunk({ content: event.delta.text });
          } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
            yield chunk({ tool_calls: [{ id: '', type: 'function', function: { name: '', arguments: event.delta.partial_json }, index: event.index ?? 0 } as ChatToolCall] });
          } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
            yield chunk({}, event.delta.stop_reason === 'tool_use' ? 'tool_calls' : event.delta.stop_reason === 'max_tokens' ? 'length' : 'stop');
          }
        }
        if (done) break;
      }
    } finally { reader.releaseLock(); }
  }
}
