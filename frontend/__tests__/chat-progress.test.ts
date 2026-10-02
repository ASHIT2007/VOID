import { describe, expect, it } from 'vitest';
import { compactProgressLabel, compactProgressTrace, progressLogForEvent, progressLabel } from '../lib/chat-progress';
import { visibleProgressLogs, extractThinkAndDisplayContent } from '../components/ChatInterface.helpers';
import { toolProgress, progressTarget } from '@void/shared/task-progress.mjs';

describe('task progress labels', () => {
  it('uses a compact live label without echoing the full specialist assignment', () => {
    const log = progressLogForEvent({ type: 'model_runtime', agentId: 'research', role: 'researcher', roleLabel: 'Researcher', uiName: 'openai/gpt-oss-20b', target: 'Research the latest Lakers information: current roster, coaching staff, recent news, schedules and historic records.' });
    expect(compactProgressLabel({ logs: [log] })).toBe('Researcher · GPT-OSS 20B — Researching');
    expect(log.query).toContain('Research the latest Lakers information');
  });
  it('condenses setup and completion updates into one row per role while retaining the model', () => {
    const identity = { agentId: 'primary', role: 'primary', roleLabel: 'Primary' };
    const logs = [progressLogForEvent({ ...identity, type: 'agent_status', status: 'started', label: 'Preparing the task', target: 'Assigning tasks to Fact checker, Researcher, Analyst, chief, image checker' }),
      progressLogForEvent({ ...identity, type: 'model_runtime', uiName: 'VOID managed' }),
      progressLogForEvent({ ...identity, type: 'agent_result', status: 'ok', uiName: 'VOID managed' }),
      progressLogForEvent({ ...identity, type: 'agent_status', status: 'completed', label: 'Primary completed' }),
      progressLogForEvent({ agentId: 'chief', role: 'custom', roleLabel: 'Chief', type: 'model_runtime', uiName: 'Qwen 72B', target: 'Review all the assigned requirements and write a comprehensive assessment.' })];
    expect(compactProgressTrace(logs)).toEqual(['Primary · VOID managed — Coordinated', 'Chief · Qwen 72B — Working']);
  });
  it('keeps concise failure and fallback details without repeating the failed role row', () => {
    const identity = { agentId: 'verify', role: 'fact_checker', roleLabel: 'Fact checker', uiName: 'openai/gpt-oss-20b' };
    const message = 'Fact checker (openai/gpt-oss-20b) is unavailable. No routing models are configured. Choose a working model or update Routing in AI & Providers.';
    const logs = [progressLogForEvent({ ...identity, type: 'model_runtime' }),
      progressLogForEvent({ ...identity, type: 'model_route', state: 'exhausted', message }),
      progressLogForEvent({ ...identity, type: 'agent_status', status: 'failed', label: 'Fact checker failed' })];
    expect(compactProgressTrace(logs)).toEqual(['Fact checker · GPT-OSS 20B unavailable · No backups']);
    expect(compactProgressLabel({ logs })).toBe('Fact checker · GPT-OSS 20B unavailable · No backups');
    expect(logs[1].action).toBe(message);
    const fallback = progressLogForEvent({ ...identity, type: 'model_route', state: 'fallback', fromModel: 'openai/gpt-oss-20b', toModel: 'Llama 70B', message: 'Fact checker (openai/gpt-oss-20b) is unavailable; routing to Llama 70B.' });
    expect(compactProgressLabel({ logs: [fallback] })).toBe('Fact checker · GPT-OSS 20B unavailable → Llama 70B');
    expect(compactProgressTrace([logs[0], fallback])).toEqual(['Fact checker · GPT-OSS 20B unavailable → Llama 70B']);
    const finished = progressLogForEvent({ ...identity, uiName: 'Llama 70B', type: 'agent_result', status: 'ok' });
    expect(compactProgressTrace([logs[0], fallback, finished])).toEqual(['Fact checker · GPT-OSS 20B → Llama 70B — Checked facts']);
  });
  it('bounds tool targets and collapses repeated image updates', () => {
    expect(compactProgressLabel({ logs: [toolProgress('web_search', { query: 'Los Angeles Lakers roster, coaching staff, historic results and current schedule' })] }).length).toBeLessThan(70);
    const logs = ['searching', 'verifying', 'completed'].map(status => progressLogForEvent({ type: 'media_status', status, label: 'Checking image relevance and provenance for the current answer' }));
    expect(compactProgressTrace(logs)).toEqual(['Images selected']);
  });
  it('keeps the actual role, model, and task visible during thinking and answer streaming', () => {
    const research = progressLogForEvent({ type: 'model_runtime', agentId: 'research', role: 'researcher', roleLabel: 'Researcher', uiName: 'Qwen 72B', modelId: 'qwen-72b', target: 'orbital telescopes' });
    expect(progressLabel({ logs: [research] })).toBe('Researcher (Qwen 72B): Researching · orbital telescopes');
    const custom = progressLogForEvent({ type: 'agent_status', agentId: 'review', role: 'custom', roleLabel: 'Accessibility reviewer', uiName: 'Llama 70B', operation: 'Checking contrast', target: 'dashboard labels' });
    expect(visibleProgressLogs([custom])[0].action).toBe('Accessibility reviewer (Llama 70B): Checking contrast');
    const writing = progressLogForEvent({ type: 'status', role: 'answer_writer', roleLabel: 'Answer writer', uiName: 'Gemini Flash', action: 'Writing your answer' });
    expect(progressLabel({ stage: 'generating', logs: [writing] })).toBe('Answer writer (Gemini Flash): Writing your answer');
  });

  it('shows fallback and exhausted-route messages verbatim instead of hiding them as internal work', () => {
    const fallback = progressLogForEvent({ type: 'model_route', agentId: 'primary', roleLabel: 'Primary', state: 'fallback', message: 'Primary (Qwen) is unavailable; routing to Llama.' });
    expect(progressLabel({ stage: 'generating', logs: [fallback] })).toBe(fallback.action);
    const exhausted = progressLogForEvent({ type: 'model_route', state: 'exhausted', message: 'Primary is unavailable. No routing models are configured.' });
    expect(visibleProgressLogs([exhausted])[0].action).toBe(exhausted.action);
    expect(progressLabel({ logs: [exhausted] })).toBe(exhausted.action);
  });

  it('retires a completed role instead of showing its earlier activity as still running', () => {
    const logs = [progressLogForEvent({ type: 'agent_status', agentId: 'research', role: 'researcher', label: 'Researching', status: 'started' }),
      progressLogForEvent({ type: 'agent_status', agentId: 'analyse', role: 'analyst', label: 'Analysing', status: 'started' }),
      progressLogForEvent({ type: 'agent_status', agentId: 'research', role: 'researcher', label: 'Task completed', status: 'completed' })];
    expect(progressLabel({ logs })).toBe('Analyst: Analysing');
  });
  it('retains the unavailable-routing message after the role fails, until another role starts', () => {
    const exhausted = progressLogForEvent({ type: 'model_route', agentId: 'primary', state: 'exhausted', message: 'Primary is unavailable. No routing models are configured.' });
    const logs = [exhausted, progressLogForEvent({ type: 'agent_status', agentId: 'primary', role: 'primary', status: 'failed', label: 'Primary failed' })];
    expect(progressLabel({ logs })).toBe(exhausted.action);
    logs.push(progressLogForEvent({ type: 'model_runtime', agentId: 'writer', role: 'answer_writer', roleLabel: 'Answer writer', uiName: 'Working model' }));
    expect(progressLabel({ logs })).toBe('Answer writer (Working model): Writing your answer');
  });
  it('shows the actual search, source and code execution as events change', () => {
    const logs = [toolProgress('web_search', { query: 'Shisui Uchiha Kotoamatsukami' })];
    expect(progressLabel({ logs })).toBe('Searching the web for “Shisui Uchiha Kotoamatsukami”');
    logs.push(toolProgress('web_fetch', { url: 'https://naruto.fandom.com/wiki/Shisui_Uchiha' }));
    expect(progressLabel({ logs })).toBe('Reading naruto.fandom.com/wiki/Shisui_Uchiha');
    logs.push(toolProgress('code_execution', { language: 'javascript', code: 'secret' }));
    expect(progressLabel({ logs })).toBe('Running JavaScript code');
    expect(progressLabel({ logs, stage: 'generating' })).toBe('Writing your answer');
  });

  it('uses the request context while waiting for the first operation', () => {
    expect(progressLabel({ prompt: 'Explain all his jutsu' })).toBe('Preparing your explanation');
    expect(progressLabel({ prompt: 'Compare two cities' })).toBe('Preparing your comparison');
    expect(progressLabel({ prompt: 'Create a presentation on space' })).toBe('Preparing your presentation');
    expect(progressLabel({ prompt: 'Create a presentation on space', stage: 'generating' })).toBe('Building your presentation');
  });

  it.each(['completed', 'omitted', 'failed'])('stops showing image work after images are %s', status => {
    const logs = [toolProgress('web_search', { query: 'Shisui' }),
      progressLogForEvent({ type: 'media_status', label: 'Searching images for Shisui', status: 'searching' }),
      progressLogForEvent({ type: 'media_status', label: 'Image update', status })];
    expect(progressLabel({ logs })).toBe('Searching the web for “Shisui”');
    expect(progressLabel({ logs: logs.slice(1) })).toBe('Reviewing your question');
    expect(progressLabel({ logs, stage: 'generating' })).toBe('Writing your answer');
  });
  it('keeps the image omission or failure reason in the execution trace', () => {
    expect(progressLogForEvent({ type: 'media_status', status: 'omitted', label: 'Web images omitted', reason: 'No concrete visual entity is central to the answer.' }))
      .toMatchObject({ kind: 'media', state: 'omitted', query: 'No concrete visual entity is central to the answer.' });
    expect(progressLogForEvent({ type: 'media_status', status: 'failed', label: 'Image relevance check failed', reason: 'Model quota unavailable.' }).query).toBe('Model quota unavailable.');
  });

  it('preserves worker tool details and repeated operations in chronological order', () => {
    const search = progressLogForEvent({ type: 'agent_status', operation: 'Searching the web', target: 'model comparison', status: 'started' });
    const logs = visibleProgressLogs([search, search, toolProgress('web_fetch', { url: 'https://example.com/source' }), search]);
    expect(logs).toHaveLength(3);
    expect(progressLabel({ logs })).toBe('Searching the web for “model comparison”');
    expect(visibleProgressLogs([progressLogForEvent({ type: 'agent_status', label: 'Synthesizing 3 agent reports' })])[0].action).toBe('Writing the response');
  });

  it('keeps labels readable without exposing URL credentials, queries or code', () => {
    expect(progressTarget('https://user:password@www.example.com/page?token=secret#key')).toBe('example.com/page');
    expect(progressTarget('a'.repeat(150))).toHaveLength(100);
    expect(progressTarget('<b>Shisui</b>\n Uchiha')).toBe('Shisui Uchiha');
    expect(toolProgress('code_execution', { code: 'private content' }).query).toBe('');
    expect(progressLabel({ logs: [toolProgress('calculator', { expression: '2+2' })] })).toBe('Calculating 2+2');
    expect(progressLabel({ logs: [toolProgress('currency_convert', { amount: 100, from: 'USD', to: 'INR' })] })).toBe('Converting currencies: 100 USD → INR');
    expect(progressLabel({ logs: [toolProgress('conversation_search', { query: 'my earlier budget' })] })).toBe('Searching your conversation: my earlier budget');
  });
});

describe('displaying saved and streamed answers', () => {
  const call = '<tool_call><function=web_search><parameter=query>Shisui</parameter></function></tool_call>';
  it('hides leaked control text while retaining surrounding answer and metadata', () => {
    expect(extractThinkAndDisplayContent(`${call}Shisui is an Uchiha.\n[META_JSON: {}]`).displayContent).toBe('Shisui is an Uchiha.\n[META_JSON: {}]');
    expect(extractThinkAndDisplayContent('<tool_ca').displayContent).toBe('');
    expect(extractThinkAndDisplayContent(call).displayContent).toBe('');
  });
  it('retains XML when the user is being shown a code example', () => {
    const example = `\`\`\`xml\n${call}\n\`\`\``;
    expect(extractThinkAndDisplayContent(example).displayContent).toBe(example);
  });
  it('hides saved and fragmented screenshot JSON while preserving intentional examples', () => {
    const call = '```json\n{"type":"web_search","query":"Satoru Gojo Jujutsu Kaisen character overview"}\n```';
    expect(extractThinkAndDisplayContent(call).displayContent).toBe('');
    expect(extractThinkAndDisplayContent(`${call}\n\nSatoru Gojo is a sorcerer.`).displayContent).toBe('Satoru Gojo is a sorcerer.');
    for (let i = 1; i <= call.length; i++) expect(extractThinkAndDisplayContent(call.slice(0, i)).displayContent).toBe('');
    expect(extractThinkAndDisplayContent(call, 'Show an example JSON tool call for web_search').displayContent).toBe(call);
  });
});
