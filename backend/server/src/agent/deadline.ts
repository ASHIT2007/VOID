export class DeadlineError extends Error {
  constructor() { super('The response time budget was reached.'); this.name = 'DeadlineError'; }
}

/** Stop awaiting providers/tools that ignore cancellation; callers gate late events by signal. */
export async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(parent?.reason); reject(parent?.reason || new Error('Request cancelled')); };
    if (parent?.aborted) { abort(); return; }
    parent?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { const error = new DeadlineError(); controller.abort(error); reject(error); }, milliseconds);
  });
  try { return await Promise.race([stopped, Promise.resolve().then(() => { controller.signal.throwIfAborted(); return operation(controller.signal); })]); }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); }
}
