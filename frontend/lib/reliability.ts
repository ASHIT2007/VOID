const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  connectTimeoutMs?: number;
  retryableStatusCodes?: ReadonlySet<number>;
  onRetry?: (attempt: number, reason: string) => void;
};

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    }, { once: true });
  });
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 2_000);
  const connectTimeoutMs = Math.max(1, options.connectTimeoutMs ?? 12_000);
  const retryable = options.retryableStatusCodes ?? RETRYABLE_STATUS_CODES;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (init.signal?.aborted) throw init.signal.reason;
    const timeoutController = new AbortController();
    const connectTimer = setTimeout(() => {
      timeoutController.abort(new DOMException("Connection timed out", "TimeoutError"));
    }, connectTimeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const response = await fetch(input, { ...init, signal });
      // This is a connection timeout, not a response-body timeout. Clear it as
      // soon as headers arrive so long SSE/model/image streams remain alive.
      clearTimeout(connectTimer);
      if (!retryable.has(response.status) || attempt === attempts) return response;

      await response.body?.cancel().catch(() => undefined);
      const retryMs = Math.min(
        retryAfterMs(response) ?? baseDelayMs * 2 ** (attempt - 1),
        maxDelayMs,
      );
      options.onRetry?.(attempt, `HTTP ${response.status}`);
      await delay(retryMs, init.signal);
    } catch (error) {
      clearTimeout(connectTimer);
      if (init.signal?.aborted) throw error;
      lastError = error;
      if (attempt === attempts) break;
      const retryMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      options.onRetry?.(attempt, error instanceof Error ? error.message : "network failure");
      await delay(retryMs, init.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("The upstream service is unreachable");
}

export function publicServiceError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/abort|timeout|timed out|econn|fetch failed|network|socket|unreachable/.test(message)) {
    return "The AI service is reconnecting. Please retry in a moment; your message is still in this chat.";
  }
  if (/rate limit|429|quota|exhausted/.test(message)) {
    return "All configured models are temporarily busy. Please retry shortly; automatic fallback will try them again.";
  }
  if (/selected model|not available|retired|does not exist/.test(message)) {
    return "That model is currently unavailable. Choose another model or retry and automatic fallback will take over.";
  }
  return "The request could not be completed safely. Please retry; the app will use another healthy provider when available.";
}
