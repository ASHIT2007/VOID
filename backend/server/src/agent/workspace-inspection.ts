import { workspaceInspectionTools } from '@void/shared/chat-intent.mjs';
import type { AgentLoopOptions } from './agent-loop.js';
import { getTool } from './tool-registry.js';

const safe = (value: unknown) => String(value ?? '').replace(/[\r\n|`<>]/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')');
export function inspectionAnswer(name: string, content: string): string {
  const data = JSON.parse(content);
  if (name === 'usage_tracker') {
    if (!Array.isArray(data.models)) throw new Error('Invalid usage result');
    if (!data.models.length) return 'No token records are stored for this conversation on this device yet. Older chats and activity on other devices may not be included. This does not mean the conversation was free.';
    const cost = data.estimatedCostUsd;
    const total = Number(data.inputTokens) + Number(data.outputTokens);
    return `### Conversation usage\n\n${Number.isFinite(cost) ? `Estimated token cost: **$${cost.toFixed(6)} USD**.` : 'Cost is **unknown** because one or more models have no saved price. Add their input and output rates in **Workspace → Usage**.'}\n\n**${total.toLocaleString('en-US')} tokens**: ${Number(data.inputTokens).toLocaleString('en-US')} input and ${Number(data.outputTokens).toLocaleString('en-US')} output.\n\n| Provider / model | Input | Output | Estimated USD |\n| --- | ---: | ---: | ---: |\n${data.models.map((row: any) => `| ${safe(row.provider)} / ${safe(row.model)} | ${row.inputTokens} | ${row.outputTokens} | ${Number.isFinite(row.estimatedCostUsd) ? '$' + row.estimatedCostUsd.toFixed(6) : 'Rate needed'} |`).join('\n')}\n\n${data.models.some((row: any) => row.estimated) ? 'Some token counts are estimated. ' : ''}These are locally recorded token charges, not an invoice. Image, voice and unreported failed-attempt charges are excluded.`;
  }
  if (!Array.isArray(data.models)) throw new Error('Invalid routing result');
  const selectedId = data.manualModelId || data.preferredModelId;
  const selected = data.models.find((model: any) => model.id === selectedId);
  return `### Connected models and routing\n\nRouting mode: **${safe(data.mode)}**. Fallback: **${data.fallbackEnabled ? 'enabled' : 'disabled'}**.${selected ? `\n\n${data.mode === 'MANUAL' ? 'Selected' : 'Preferred'} model: **${safe(selected.name || selected.model)}**.` : ''}\n\n${data.models.length ? '| Model | Provider | Capabilities |\n| --- | --- | --- |\n' + data.models.map((model: any) => `| ${safe(model.name || model.model)} | ${safe(model.provider)} | ${Object.entries(model.capabilities || {}).filter(([, enabled]) => enabled === true).map(([key]) => safe(key)).join(', ') || 'Not reported'} |`).join('\n') : 'No enabled models are connected.'}\n\nThis is your current configured routing; automatic selection can vary by task and model availability.`;
}

export async function runWorkspaceInspection(options: Pick<AgentLoopOptions, 'message' | 'signal' | 'allowedTools' | 'onEvent'>): Promise<boolean> {
  const names = workspaceInspectionTools(options.message || '');
  if (!names.length) return false;
  const answers: string[] = [];
  for (const name of names) {
    if (options.signal?.aborted) return true;
    options.onEvent({ type: 'progress', action: name === 'usage_tracker' ? 'Reading conversation usage' : 'Checking connected models and routing' });
    try {
      const tool = getTool(name);
      if (!tool || options.allowedTools && !options.allowedTools.includes(name)) throw new Error('This lookup is unavailable in the current chat.');
      const result = await tool.handler(name === 'provider_router' ? { action: 'inspect' } : {});
      if (result.error) { answers.push(result.content); continue; }
      answers.push(inspectionAnswer(name, result.content));
    } catch {
      answers.push(name === 'usage_tracker' ? 'Could not read this conversation’s local usage. Open Workspace → Usage to check device storage and saved model rates.' : 'Could not read your connected models. Open Settings → Providers to check the connection.');
    }
  }
  if (!options.signal?.aborted) {
    const content = answers.join('\n\n');
    options.onEvent({ type: 'text_delta', content }); options.onEvent({ type: 'done', fullText: content });
  }
  return true;
}
