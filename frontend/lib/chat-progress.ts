import { progressTarget } from '@void/shared/task-progress.mjs';

export type ProgressLog = { action: string; query: string; kind?: string; state?: string };

export function progressLogForEvent(event: Record<string, unknown>): ProgressLog {
  if (event.type === 'media_status') {
    return { action: String(event.label || 'Checking images'), query: progressTarget(event.reason || '', 240), kind: 'media', state: String(event.status || 'active') };
  }
  return { action: String(event.operation || event.action || event.label || 'Reviewing your request'),
    query: progressTarget(event.query || event.target), kind: String(event.kind || (event.operation || event.action ? 'task' : 'agent')),
    state: String(event.state || (event.type === 'agent_status' && ['completed', 'failed'].includes(String(event.status)) ? event.status : 'active')) };
}

function preparationLabel(prompt: string): string {
  if (/\b(?:presentation|slides?|powerpoint|pptx?|deck)\b/i.test(prompt)) return 'Preparing your presentation';
  if (/\b(?:poster|infographic|design)\b/i.test(prompt)) return 'Planning your design';
  if (/\b(?:summarize|summary|summarise)\b/i.test(prompt)) return 'Preparing your summary';
  if (/\b(?:compare|comparison|versus)\b/i.test(prompt)) return 'Preparing your comparison';
  if (/\b(?:code|debug|program|function|script)\b/i.test(prompt)) return 'Reviewing your coding request';
  if (/\b(?:explain|how|why)\b/i.test(prompt)) return 'Preparing your explanation';
  return 'Reviewing your question';
}

export function progressLabel({ stage = 'thinking', prompt = '', logs = [], isGeneratingImage = false }: {
  stage?: string; prompt?: string; logs?: Partial<ProgressLog>[]; isGeneratingImage?: boolean;
}): string {
  if (isGeneratingImage || stage === 'painting') return 'Creating your image';
  if (stage === 'generating') return /\b(?:presentation|slides?|powerpoint|pptx?|deck)\b/i.test(prompt) ? 'Building your presentation'
    : /\b(?:chart|graph|plot)\b/i.test(prompt) ? 'Building your chart' : 'Writing your answer';
  const terminalStates = ['completed', 'omitted', 'failed'];
  const mediaFinishedAt = logs.map(log => log.kind === 'media' && terminalStates.includes(log.state || '')).lastIndexOf(true);
  const latest = logs.filter((log, index) => log.kind !== 'media' || index > mediaFinishedAt).reverse()
    .find(log => log.action && !terminalStates.includes(log.state || ''));
  if (!latest) return preparationLabel(prompt);
  const action = progressTarget(latest.action, 140);
  const target = progressTarget(latest.query);
  if (/^reviewing (?:your |the )?request$/i.test(action)) return preparationLabel(prompt);
  if (/^using tool$/i.test(action)) return 'Processing the next step';
  if (!target) return action;
  if (/^Searching the (?:web|news)$/.test(action)) return `${action} for “${target}”`;
  if (action === 'Finding images') return `Finding images of “${target}”`;
  if (action === 'Reading a source') return `Reading ${target}`;
  if (action === 'Calculating') return `Calculating ${target}`;
  if (action === 'Reading a file') return `Reading ${target}`;
  if (action === 'Writing a file') return `Writing ${target}`;
  return `${action}: ${target}`;
}
