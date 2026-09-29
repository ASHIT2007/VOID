import { describe, expect, it } from 'vitest';
import { progressLogForEvent, progressLabel } from '../lib/chat-progress';
import { visibleProgressLogs, extractThinkAndDisplayContent } from '../components/ChatInterface.helpers';
import { toolProgress, progressTarget } from '@void/shared/task-progress.mjs';

describe('task progress labels', () => {
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
