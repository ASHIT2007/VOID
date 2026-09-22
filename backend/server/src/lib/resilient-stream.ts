/** Bound silent providers, including ones that ignore AbortSignal. */
export async function* resilientStream<T>(
  stream: AsyncIterable<T>,
  controller: AbortController,
  firstChunkMs = 10_000,
  idleMs = 15_000,
): AsyncGenerator<T> {
  const iterator = stream[Symbol.asyncIterator]();
  let first = true;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try {
        const next = await Promise.race([
          iterator.next(),
          new Promise<never>((_, reject) => {
            onAbort = () => reject(controller.signal.reason ?? new Error('Request aborted'));
            controller.signal.addEventListener('abort', onAbort, { once: true });
            if (controller.signal.aborted) return onAbort();
            timer = setTimeout(() => {
              controller.abort(new Error('Provider response timed out'));
            }, first ? firstChunkMs : idleMs);
          }),
        ]);
        if (next.done) return;
        first = false;
        yield next.value;
      } finally {
        clearTimeout(timer);
        if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      }
    }
  } finally {
    // Do not block fallback on an iterator that ignores cancellation.
    void iterator.return?.().catch(() => undefined);
  }
}
