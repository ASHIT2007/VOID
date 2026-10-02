import { progressTarget } from '@void/shared/task-progress.mjs';

export type ProgressLog = { action: string; query: string; kind?: string; state?: string; agentId?: string; role?: string; roleLabel?: string; uiName?: string; modelId?: string; fromModel?: string; toModel?: string };

const roleNames: Record<string, string> = { primary: 'Primary', researcher: 'Researcher', analyst: 'Analyst', fact_checker: 'Fact checker', answer_writer: 'Answer writer', custom: 'Custom role', general: 'Primary' };
const roleTasks: Record<string, string> = { primary: 'Coordinating the request', researcher: 'Researching', analyst: 'Analysing', fact_checker: 'Checking facts', answer_writer: 'Writing your answer', custom: 'Working on the assigned task', general: 'Reviewing your request' };

export function progressLogForEvent(event: Record<string, unknown>): ProgressLog {
  if (event.type === 'media_status') {
    return { action: String(event.label || 'Checking images'), query: progressTarget(event.reason || '', 240), kind: 'media', state: String(event.status || 'active') };
  }
  const identity = { agentId: typeof event.agentId === 'string' ? event.agentId : undefined,
    role: typeof event.role === 'string' ? event.role : undefined,
    roleLabel: typeof event.roleLabel === 'string' ? progressTarget(event.roleLabel, 60) : undefined,
    uiName: typeof event.uiName === 'string' ? progressTarget(event.uiName, 100) : undefined,
    modelId: typeof event.modelId === 'string' ? event.modelId : undefined };
  if (event.type === 'model_route') return { ...identity, action: progressTarget(event.message, 340), query: '', kind: 'routing', state: String(event.state || 'active'),
    fromModel: typeof event.fromModel === 'string' ? event.fromModel : undefined, toModel: typeof event.toModel === 'string' ? event.toModel : undefined };
  const named = Boolean(identity.roleLabel || identity.role);
  const roleName = identity.roleLabel || roleNames[identity.role || ''] || 'Primary';
  const actor = `${roleName}${identity.uiName ? ` (${identity.uiName})` : ''}`;
  const task = event.type === 'model_runtime' ? roleTasks[identity.role || 'general'] || 'Working on the assigned task'
    : event.type === 'agent_result' ? event.status === 'failed' ? 'Could not complete the task' : event.status === 'partial' ? 'Completed with limitations' : 'Task completed'
    : String(event.operation || event.action || event.label || 'Reviewing your request');
  const state = event.type === 'agent_result' ? event.status === 'failed' ? 'failed' : 'completed' : String(event.state || (event.type === 'agent_status' && ['completed', 'failed'].includes(String(event.status)) ? event.status : 'active'));
  if (named) return { ...identity, action: `${actor}: ${task}`, query: progressTarget(event.query || event.target), kind: 'execution', state };
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
  const terminalStates = ['completed', 'omitted', 'failed'];
  const lastFinished = new Map<string, number>();
  logs.forEach((log, index) => { if (log.agentId && terminalStates.includes(log.state || '')) lastFinished.set(log.agentId, index); });
  const mediaFinishedAt = logs.map(log => log.kind === 'media' && terminalStates.includes(log.state || '')).lastIndexOf(true);
  const latest = logs.filter((log, index) => (log.kind !== 'media' || index > mediaFinishedAt)
    && (log.kind === 'routing' && log.state === 'exhausted' || !log.agentId || index > (lastFinished.get(log.agentId) ?? -1))).reverse()
    .find(log => log.action && !terminalStates.includes(log.state || ''));
  if (latest?.kind === 'routing') return latest.action || '';
  if (latest?.kind === 'execution') return `${latest.action}${latest.query ? ` · ${progressTarget(latest.query)}` : ''}`;
  if (latest?.kind === 'media') return latest.action || 'Checking images';
  if (stage === 'generating') return /\b(?:presentation|slides?|powerpoint|pptx?|deck)\b/i.test(prompt) ? 'Building your presentation'
    : /\b(?:chart|graph|plot)\b/i.test(prompt) ? 'Building your chart' : 'Writing your answer';
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

// Display-only summaries: keep the complete execution records in message storage.
function compactModel(value = ''): string {
  const name = value.replace(/^.*\//, '').replace(/^gpt-oss-(\d+)b$/i, 'GPT-OSS $1B');
  return progressTarget(name, 26);
}

function compactTask(log: Partial<ProgressLog>): string {
  const actor = log.roleLabel || roleNames[log.role || ''];
  const action = actor && log.action?.startsWith(actor)
    ? log.action.slice(actor.length).replace(/^\s*\(.*\):\s*|^:\s*/, '')
    : (log.action || '').replace(/^.*?:\s*/, '');
  if (/limitations|partial/i.test(action)) return 'Limited result';
  if (log.state === 'failed') return 'Failed';
  if (log.state === 'completed') return ({ primary: 'Coordinated', researcher: 'Researched', analyst: 'Analysed', fact_checker: 'Checked facts', answer_writer: 'Answered', custom: 'Finished' } as Record<string, string>)[log.role || ''] || 'Done';
  if (/preparing the task|reviewing your request/i.test(action)) return 'Preparing';
  if (/coordinat|assigning/i.test(action)) return 'Coordinating';
  if (/analys/i.test(action)) return 'Analysing';
  if (/checking facts|fact.?check|verif/i.test(action)) return 'Checking facts';
  if (/reading a source|reviewing source/i.test(action)) return 'Reading sources';
  if (/research|searching the web|reviewing search|searching the news/i.test(action)) return 'Researching';
  if (/writing your answer|combining findings/i.test(action)) return 'Writing';
  if (/working on the assigned task/i.test(action)) return 'Working';
  return progressTarget(action, 32);
}

export function compactProgressLog(log: Partial<ProgressLog>): string {
  const action = log.action || '';
  const role = progressTarget(log.roleLabel || roleNames[log.role || ''] || action.match(/^([^(:]+)\s*(?:\(|:)/)?.[1]?.trim() || action.match(/^(.+?)\s+is unavailable/i)?.[1] || 'Model', 24);
  if (log.kind === 'routing') {
    const from = compactModel(log.fromModel || action.match(/\(([^)]+)\).*?unavailable/i)?.[1] || log.uiName || '');
    const to = compactModel(log.toModel || action.match(/routing to (.+?)(?:\.\s|\.$|$)/i)?.[1] || '');
    const actor = `${role}${from ? ` · ${from}` : ''}`;
    if (to && log.state !== 'exhausted') return `${actor} unavailable → ${to}`;
    const reason = /no routing models are configured/i.test(action) ? 'No backups'
      : /routing is disabled/i.test(action) ? 'Routing off'
      : /routing models/i.test(action) ? 'No working backups' : 'No models available';
    return `${actor} unavailable · ${reason}`;
  }
  if (log.kind === 'execution' || log.role || log.roleLabel) {
    const model = compactModel(log.uiName || action.match(/\(([^)]+)\):/)?.[1] || '');
    const from = compactModel(log.fromModel);
    const models = from && log.toModel && from !== model ? `${from} → ${model || compactModel(log.toModel)}` : model;
    return `${role}${models ? ` · ${models}` : ''} — ${compactTask(log)}`;
  }
  if (log.kind === 'media') {
    if (log.state === 'omitted') return 'Images skipped';
    if (log.state === 'failed') return 'Images unavailable';
    if (log.state === 'completed') return 'Images selected';
    return /verif|relevance/i.test(action) ? 'Checking images' : 'Finding images';
  }
  return `${progressTarget(action, 36)}${log.query ? ` · ${progressTarget(log.query, 28)}` : ''}`;
}

export function compactProgressLabel(options: Parameters<typeof progressLabel>[0]): string {
  const full = progressLabel(options);
  const current = [...(options.logs || [])].reverse().find(log => log.action && full.startsWith(log.action));
  return current ? compactProgressLog(current) : progressTarget(full, 72);
}

export function compactProgressTrace(logs: Partial<ProgressLog>[]): string[] {
  const rows = new Map<string, Partial<ProgressLog>>();
  for (const log of logs) {
    if (!log.action) continue;
    const actor = log.agentId || log.roleLabel || log.role;
    const key = actor ? `role:${actor}` : log.kind === 'routing' ? `route:${log.action}`
      : log.kind === 'media' ? 'media' : `task:${compactProgressLog(log)}`;
    const previous = rows.get(key);
    const defined = Object.fromEntries(Object.entries(log).filter(([, value]) => value !== undefined));
    const merged = { ...previous, ...defined };
    if (previous?.kind === 'routing' && log.kind === 'execution') {
      if (previous.state === 'exhausted' && log.state === 'failed') {
        merged.kind = 'routing'; merged.state = 'exhausted'; merged.action = previous.action;
      } else {
        merged.fromModel = previous.fromModel || previous.action?.match(/\(([^)]+)\).*?unavailable/i)?.[1];
        merged.toModel = previous.toModel || previous.action?.match(/routing to (.+?)(?:\.\s|\.$|$)/i)?.[1];
      }
    }
    rows.set(key, merged);
  }
  return [...rows.values()].map(compactProgressLog).filter((line, index, all) => all.indexOf(line) === index);
}
