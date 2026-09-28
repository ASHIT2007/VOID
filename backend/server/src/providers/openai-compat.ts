import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
  Platform,
} from '@void/shared/types.js';
import { BaseProvider, type CompletionOptions } from './base.js';
import { safeProviderRequest } from '../lib/safe-provider-request.js';
import { createHash } from 'node:crypto';

/**
 * Generic provider for platforms that use an OpenAI-compatible API.
 * Covers: Groq, Cerebras, SambaNova, NVIDIA NIM, Mistral, OpenRouter,
 * GitHub Models, Fireworks AI.
 */
export class OpenAICompatProvider extends BaseProvider {
  readonly platform: Platform;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly validateUrl?: string;
  /** Per-provider HTTP timeout override. Cloud APIs finish in ~15s; locally-hosted
   * inference (llama.cpp / vLLM on CPU) can take 30-120s for long prompts. Default 15000. */
  private readonly timeoutMs: number;
  private readonly publicOnly: boolean;
  private readonly tokenBudgets = new Map<string, { remaining: number; expires: number }>();

  private quotaKey(apiKey: string, modelId: string): string {
    return createHash('sha256').update(`${apiKey}\0${modelId}`).digest('hex');
  }

  // Groq reports its account's actual TPM headroom on every response. BYOK
  // routes lack a local quota catalog; do not reserve a full completion again
  // after spending tokens on research. Credentials are never stored here.
  private observeQuota(response: Response, apiKey: string, modelId: string) {
    if (this.platform !== 'groq' || !response.headers?.get) return;
    const raw = response.headers.get('x-ratelimit-remaining-tokens');
    const remaining = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(remaining) || remaining < 0) return;
    const reset = response.headers.get('x-ratelimit-reset-tokens') || '';
    let resetMs = 0;
    for (const match of reset.matchAll(/([\d.]+)(ms|s|m|h)/g)) resetMs += Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]] || 0);
    if (this.tokenBudgets.size >= 512) this.tokenBudgets.delete(this.tokenBudgets.keys().next().value!);
    this.tokenBudgets.set(this.quotaKey(apiKey, modelId), { remaining, expires: Date.now() + Math.min(60000, resetMs || 60000) });
  }

  private outputBudget(apiKey: string, messages: ChatMessage[], modelId: string, options?: CompletionOptions) {
    const budget = this.tokenBudgets.get(this.quotaKey(apiKey, modelId));
    if (!budget || budget.expires <= Date.now() || !options?.max_tokens) return options?.max_tokens;
    const input = Math.ceil((JSON.stringify(messages).length + JSON.stringify(options.tools || []).length) / 3) + 128;
    return Math.min(options.max_tokens, Math.max(128, budget.remaining - input));
  }

  private async apiError(response: Response): Promise<Error> {
    let limit = '';
    try {
      const payload = await response.json() as { error?: { message?: string } };
      limit = typeof payload.error?.message === 'string' ? payload.error.message.match(/(?:tokens|requests) per (?:day|minute)/i)?.[0] || '' : '';
    } catch { /* Do not expose upstream response bodies or account identifiers. */ }
    return Object.assign(new Error(`${this.name} API error ${response.status}${limit ? ` (${limit})` : ''}`), { status: response.status });
  }

  constructor(opts: {
    platform: Platform;
    name: string;
    baseUrl: string;
    extraHeaders?: Record<string, string>;
    validateUrl?: string;
    timeoutMs?: number;
    keyless?: boolean;
    publicOnly?: boolean;
  }) {
    super();
    this.platform = opts.platform;
    this.name = opts.name;
    this.baseUrl = opts.baseUrl;
    this.extraHeaders = opts.extraHeaders ?? {};
    this.validateUrl = opts.validateUrl;
    this.timeoutMs = opts.timeoutMs ?? 600000;
    this.keyless = opts.keyless ?? false;
    this.publicOnly = opts.publicOnly ?? false;
  }

  protected override fetchWithTimeout(url: string, init: RequestInit, timeoutMs = this.timeoutMs): Promise<Response> {
    return this.publicOnly ? safeProviderRequest(url, init, timeoutMs) : super.fetchWithTimeout(url, init, timeoutMs);
  }

  /** Keyless providers (Kilo's anonymous free tier) must send NO Authorization
   * header — a stored sentinel like `Bearer no-key` could be treated as an
   * invalid key. Everyone else sends the bearer as usual. */
  private authHeader(apiKey: string): Record<string, string> {
    return this.keyless ? {} : { 'Authorization': `Bearer ${apiKey}` };
  }

  async chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): Promise<ChatCompletionResponse> {
    let res = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: options?.signal,
      headers: {
        ...this.authHeader(apiKey),
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: this.platform === 'openai' && /^(?:o[134]|gpt-5)/i.test(modelId) ? undefined : options?.temperature,
        max_tokens: this.outputBudget(apiKey, messages, modelId, options),
        reasoning_effort: this.platform === 'groq' && /^openai\/gpt-oss-(?:20|120)b$/.test(modelId) ? options?.reasoning_effort : undefined,
        top_p: this.platform === 'custom' ? undefined : options?.top_p,
        tools: options?.tools,
        tool_choice: options?.tool_choice,
        parallel_tool_calls: this.platform === 'custom' ? undefined : options?.parallel_tool_calls,
      }),
    }, this.timeoutMs);

    if (res.status === 400 && this.platform === 'custom') {
      await res.body?.cancel();
      res = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
        method: 'POST', signal: options?.signal,
        headers: { ...this.authHeader(apiKey), 'Content-Type': 'application/json', ...this.extraHeaders },
        body: JSON.stringify({ model: modelId, messages, max_completion_tokens: options?.max_tokens,
          tools: options?.tools, tool_choice: options?.tool_choice }),
      }, this.timeoutMs);
    }

    this.observeQuota(res, apiKey, modelId);
    if (!res.ok) {
      throw await this.apiError(res);
    }

    let data: ChatCompletionResponse;
    try {
      data = await res.json() as ChatCompletionResponse;
    } catch {
      // A 200 whose body isn't a single JSON document — typically a base URL
      // pointing at a non-OpenAI-compatible API (e.g. Ollama's native NDJSON
      // /api endpoints instead of /v1, #189). Surface what's wrong instead of
      // the raw JSON.parse position error.
      throw new Error(
        `${this.name} returned 200 with a non-JSON body — the endpoint is not OpenAI-compatible. ` +
        `Check the base URL (for Ollama use http://host:11434/v1, for llama.cpp/vLLM/LM Studio the /v1 path).`,
      );
    }
    normalizeChoices(data);
    data._routed_via = { platform: this.platform, model: modelId };
    return data;
  }

  async *streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): AsyncGenerator<ChatCompletionChunk> {
    let res = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: options?.signal,
      headers: {
        ...this.authHeader(apiKey),
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: this.platform === 'openai' && /^(?:o[134]|gpt-5)/i.test(modelId) ? undefined : options?.temperature,
        max_tokens: this.outputBudget(apiKey, messages, modelId, options),
        reasoning_effort: this.platform === 'groq' && /^openai\/gpt-oss-(?:20|120)b$/.test(modelId) ? options?.reasoning_effort : undefined,
        top_p: this.platform === 'custom' ? undefined : options?.top_p,
        tools: options?.tools,
        tool_choice: options?.tool_choice,
        parallel_tool_calls: this.platform === 'custom' ? undefined : options?.parallel_tool_calls,
        stream: true,
        // Avoid sending optional extensions to unknown/custom endpoints.
        stream_options: this.platform === 'openai' || this.platform === 'groq' ? { include_usage: true } : undefined,
      }),
    }, this.timeoutMs);

    if (res.status === 400 && this.platform === 'custom') {
      await res.body?.cancel();
      res = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
        method: 'POST', signal: options?.signal,
        headers: { ...this.authHeader(apiKey), 'Content-Type': 'application/json', ...this.extraHeaders },
        body: JSON.stringify({ model: modelId, messages, stream: true, max_completion_tokens: options?.max_tokens,
          tools: options?.tools, tool_choice: options?.tool_choice }),
      }, this.timeoutMs);
    }

    this.observeQuota(res, apiKey, modelId);
    if (!res.ok) {
      throw await this.apiError(res);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          yield JSON.parse(data) as ChatCompletionChunk;
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }

  async validateKey(apiKey: string): Promise<boolean> {
    // Note: transport errors (DNS / timeout / TLS) propagate to the caller.
    // health.ts catches them and marks status='error' WITHOUT incrementing
    // the consecutive-failure counter — only confirmed 401/403 disables a key.
    const url = this.validateUrl ?? `${this.baseUrl}/models`;
    // 30s (not 10s): some upstreams return a large /v1/models catalog that
    // takes >10s from high-latency regions (e.g. NVIDIA NIM measured ~11.2s
    // from India). A 10s cap aborted those calls and health.ts marked a
    // perfectly good key status='error'. 30s aligns with chatCompletion's
    // own slow-upstream allowance and costs nothing for fast providers.
    const res = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        ...this.authHeader(apiKey),
        ...this.extraHeaders,
      },
    }, 30000);
    return res.status !== 401 && res.status !== 403;
  }
}

/**
 * Some providers (Z.ai glm-4.5-flash, Cloudflare DeepSeek-R1-distill, others)
 * return reasoning models' actual answer in `message.reasoning_content` with
 * `message.content === ""`. Fold reasoning_content into content so OpenAI-
 * compatible clients see a non-empty assistant message.
 *
 * Other providers (Mistral magistral-medium) return `message.content` as an
 * array of text segments instead of a string. Flatten to string.
 */
function normalizeChoices(data: ChatCompletionResponse): void {
  for (const choice of data.choices ?? []) {
    const msg = choice.message as ChatMessage & {
      reasoning_content?: string;
      reasoning?: string;
      content: unknown;
    };
    // Flatten array content (Mistral magistral) → join text segments.
    if (Array.isArray(msg.content)) {
      msg.content = (msg.content as Array<{ text?: string; type?: string }>)
        .map(seg => (typeof seg === 'string' ? seg : (seg.text ?? '')))
        .join('');
    }
    // Fold reasoning into content if content is empty AND there are no
    // tool_calls. With tool_calls present, content=null is the correct OpenAI
    // shape; folding reasoning would confuse clients that branch on content.
    // Field naming varies by provider: Z.ai uses `reasoning_content`, Ollama
    // uses `reasoning`. Prefer `reasoning_content` when both are set.
    const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    if (!hasToolCalls && (msg.content === '' || msg.content == null)) {
      const fold = (typeof msg.reasoning_content === 'string' && msg.reasoning_content.length > 0)
        ? msg.reasoning_content
        : (typeof msg.reasoning === 'string' && msg.reasoning.length > 0 ? msg.reasoning : null);
      if (fold !== null) msg.content = fold;
    }
  }
}
