import crypto from 'crypto';
import { runAgentLoop, type AgentLoopOptions } from './agent-loop.js';

export function canShowResponseOpening(message: string): boolean {
  return !/\b(?:only|exactly|nothing else|no (?:prose|preamble|explanation)|json|csv|xml)\b|```/i.test(message);
}

/** Generate a short public introduction concurrently with research, never hidden reasoning. */
export function startResponseOpening(options: AgentLoopOptions): () => void {
  const controller = new AbortController();
  let active = true;
  let text = '';
  const cancel = () => { active = false; controller.abort(); clearTimeout(timer); };
  const timer = setTimeout(cancel, 8_000);
  const parentAbort = () => cancel();
  options.signal?.addEventListener('abort', parentAbort, { once: true });
  if (options.signal?.aborted) cancel();

  void runAgentLoop({
    ...options,
    sessionId: `opening-${crypto.randomUUID()}`,
    mode: 'normal',
    reasoningEffort: 'low',
    searchMode: 'off',
    attachments: [],
    allowedTools: [],
    maxIterations: 1,
    maxOutputTokens: 128,
    signal: controller.signal,
    systemContext: 'Write only one or two short, natural sentences to open the response to this user. Ground the opening in their specific topic and explain the scope you will examine while the answer is prepared. Do not give conclusions, unverified facts, an answer, private reasoning, citations, headings, or generic filler. Do not claim that research has already happened. Follow the language of the user. Return plain prose, at most 60 words.',
    onEvent: (event) => {
      if (!active) return;
      if (event.type === 'text_delta') text += event.content;
      else if (event.type === 'response_reset') text = '';
      else if (event.type === 'done') {
        const opening = text.trim();
        if (opening && opening.length <= 500 && !/[<>{}]|```/.test(opening)) {
          options.onEvent({ type: 'text_delta', content: `${opening}\n\n` });
          options.onEvent({ type: 'thinking', content: options.sessionId || '' });
        }
        cancel();
      }
    },
  }).catch(() => { /* An optional opening must never interrupt the answer. */ }).finally(() => {
    cancel();
    options.signal?.removeEventListener('abort', parentAbort);
  });
  return cancel;
}
