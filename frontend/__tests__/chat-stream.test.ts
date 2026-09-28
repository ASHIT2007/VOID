import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/chat/route';
import { fetchWithRetry } from '../lib/reliability';

vi.mock('../lib/deployment-access', () => ({ requireDeploymentAccess: () => null }));
vi.mock('../lib/ai/server', () => ({ authenticatedUser: async () => 'user-a',
  loadByokContext: async () => ({ userId: 'user-a', mode: 'AUTO', models: [{ id: 'test-model', enabled: true, capabilities: { text: true } }] }),
  serviceDb: vi.fn() }));
vi.mock('../lib/ai/client', () => ({ generateUserText: vi.fn() }));
vi.mock('../lib/reliability', () => ({ fetchWithRetry: vi.fn(), publicServiceError: () => 'Service unavailable' }));

afterEach(() => vi.unstubAllEnvs());

async function readEvents(events: Record<string, unknown>[], request = 'Explain Shisui and his jutsu') {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
  const encoded = new TextEncoder().encode(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  vi.mocked(fetchWithRetry).mockResolvedValue(new Response(new ReadableStream({ start(controller) {
    // Split even UTF-8 characters and event fields across reads.
    for (let offset = 0; offset < encoded.length; offset += 7) controller.enqueue(encoded.slice(offset, offset + 7));
    controller.close();
  } })));
  const response = await POST(new NextRequest('http://localhost/api/chat', { method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: request }], model: 'Auto' }) }));
  expect(response.status).toBe(200);
  return (await response.text()).split('\n\n').filter(block => block.startsWith('data: ')).map(block => JSON.parse(block.slice(6)));
}

describe('backend progress reaching the chat stream', () => {
  it('preserves a mind map as a fenced diagram and suppresses unrelated media', async () => {
    const content = '```mermaid\nmindmap\n  root((Machine learning))\n    Supervised learning\n      Classification\n    Unsupervised learning\n      Clustering\n```';
    const events = await readEvents([{ type: 'media', images: [{ url: 'https://example.com/unrelated.png' }] }, { type: 'text_delta', content }, { type: 'done', fullText: content }], 'make a mind map about machine learning');
    expect(events.filter(event => event.type === 'text')).toEqual([{ type: 'text', content }]);
    expect(events.some(event => event.type === 'media')).toBe(false);
  });
  it('does not display flattened Mermaid or presentation labels as a diagram', async () => {
    const content = 'mermaid flowchart TD A[Start] --> B[Login]\n\nKey findings: gamma-presentation';
    const events = await readEvents([{ type: 'text_delta', content }, { type: 'done', fullText: content }], 'make a mermaid flowchart for user login');
    expect(events.some(event => event.type === 'text')).toBe(false);
    expect(events).toContainEqual({ type: 'error', error: expect.stringContaining('complete diagram') });
  });
  it('buffers chart generation and emits only the complete validated artifact', async () => {
    const content = 'Three categories compared.\n\n```chart\n{"type":"bar","title":"Comparison","bars":[{"label":"A","value":12},{"label":"B","value":27}]}\n```';
    const events = await readEvents([
      { type: 'text_delta', content: content.slice(0, 65) },
      { type: 'text_delta', content: content.slice(65) },
      { type: 'done', fullText: content },
    ], 'Make a bar chart');
    const text = events.filter(event => event.type === 'text');
    expect(text).toHaveLength(1);
    expect(text[0].content).toContain('Three categories compared.\n\n```chart\n');
    expect(text[0].content).toContain('"background":"transparent"');
    expect(events.some(event => event.type === 'error')).toBe(false);
  });
  it('does not expose malformed chart code as the answer', async () => {
    const events = await readEvents([{ type: 'text_delta', content: '```python\nplot_unknown_values()\n```' },
      { type: 'done', fullText: '```python\nplot_unknown_values()\n```' }], 'Make a chart');
    const text = events.filter(event => event.type === 'text').map(event => event.content).join('');
    expect(text).toContain('provide comparable values');
    expect(text).not.toMatch(/plot_unknown_values|```|valid numeric data/);
    expect(events.some(event => event.type === 'error')).toBe(false);
  });
  it('adds a content-based presentation brief before its card payload', async () => {
    const deck = { id: 'test-deck', title: 'World War II', theme: 'academic-clean', slides: [
      { id: 'one', slideNumber: 1, layout: 'editorial', title: 'World War II', content: {} },
      { id: 'two', slideNumber: 2, layout: 'editorial', title: 'Major turning points', content: { bodyText: 'The presentation compares major developments across the conflict and explains how decisions and events affected the course and eventual outcome of the war.' } },
    ] };
    const content = '```gamma-presentation\n' + JSON.stringify(deck) + '\n```';
    const events = await readEvents([{ type: 'text_delta', content }, { type: 'done', fullText: content }], 'Make a ppt on World War II, preview only');
    const text = events.filter(event => event.type === 'text').map(event => event.content).join('');
    expect(text).toMatch(/^I created a 2-slide presentation titled “World War II”\. It covers Major turning points\./);
    expect(events.some(event => event.type === 'error')).toBe(false);
  });
  it.each(['Make a PowerPoint on World War II', 'Create Excel monthly sales', 'Make a PDF report on solar energy'])('delivers a genuine download brief for %s without preview repair', async request => {
    const name = request.includes('PowerPoint') ? 'generate_presentation' : request.includes('Excel') ? 'generate_spreadsheet' : 'generate_pdf';
    const content = 'Created the requested file.\n\n[Download report](#void-file-12345678-1234-1234-1234-123456789abc)';
    const events = await readEvents([{ type: 'tool_call', name, callId: 'file-1', args: { title: 'Report' } },
      { type: 'client_tool', name, requestId: 'file-1', args: { title: 'Report' } },
      { type: 'tool_result', callId: 'file-1', content }, { type: 'done', fullText: '' }], request);
    expect(events.filter(event => event.type === 'text').map(event => event.content).join('')).toBe(content);
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(events.some(event => event.action === 'Waiting for your approval')).toBe(false);
    const forwarded = JSON.parse(String(vi.mocked(fetchWithRetry).mock.calls.at(-1)?.[1]?.body));
    expect(forwarded.artifactInstructions).toContain(name);
    expect(forwarded.artifactInstructions).not.toContain('gamma-presentation');
  });
  it('rejects preview code masquerading as a completed file', async () => {
    const content = 'Here is your Excel file.\n\n```python\ncreate_workbook()\n```';
    const events = await readEvents([{ type: 'text_delta', content }, { type: 'done', fullText: content }], 'Create Excel monthly sales');
    expect(events.some(event => event.type === 'text')).toBe(false);
    expect(events.find(event => event.type === 'error')?.error).toContain('did not create the requested file');
  });
  it('retains queries, result review, worker operations, media completion and answer phases', async () => {
    const events = await readEvents([
      { type: 'progress', action: 'Reviewing your request' },
      { type: 'text_delta', content: 'I will check the sources. ' },
      { type: 'tool_call', name: 'web_search', callId: 'search-1', args: { query: 'Shisui’s Sharingan' } },
      { type: 'tool_result', callId: 'search-1', content: 'search results' },
      { type: 'agent_status', agentId: 'researcher', role: 'researcher', status: 'started', label: 'Reading a source', operation: 'Reading a source', target: 'https://example.com/shisui?token=private' },
      { type: 'media_status', status: 'completed', label: '1 relevant web image selected' },
      { type: 'progress', action: 'Preparing the answer from the results' },
      { type: 'text_delta', content: 'Shisui is an Uchiha.' },
      { type: 'done', fullText: 'I will check the sources. Shisui is an Uchiha.' },
    ]);
    expect(events).toContainEqual({ type: 'status', action: 'Searching the web', query: 'Shisui’s Sharingan', kind: 'task', state: 'active' });
    expect(events).toContainEqual({ type: 'status', action: 'Reviewing search results', query: 'Shisui’s Sharingan', kind: 'task', state: 'active' });
    expect(events.find(event => event.type === 'agent_status').target).toBe('example.com/shisui');
    expect(events.find(event => event.type === 'media_status').status).toBe('completed');
    const textIndex = events.findIndex(event => event.type === 'text');
    expect(events.slice(0, textIndex)).toContainEqual({ type: 'phase', phase: 'generating' });
    expect(events[textIndex].content).toBe('I will check the sources. ');
    const workerIndex = events.findIndex(event => event.type === 'agent_status');
    expect(events[workerIndex - 1]).toEqual({ type: 'phase', phase: 'thinking' });
    expect(events.filter(event => event.type === 'text').map(event => event.content).join('')).toBe('I will check the sources. Shisui is an Uchiha.');
    expect(events.some(event => event.type === 'error')).toBe(false);
  });

  it('shows deep research queries, source titles and gap checking', async () => {
    const events = await readEvents([
      { type: 'planning', subQuestions: ['Shisui jutsu'] },
      { type: 'searching', query: 'Kotoamatsukami', queryIndex: 0, totalQueries: 2 },
      { type: 'reading', title: 'Shisui Uchiha biography', url: 'https://example.com/shisui' },
      { type: 'analyzing_gaps', round: 1 },
      { type: 'synthesizing' },
      { type: 'report', content: 'Research answer.', sources: [] },
      { type: 'done', fullText: 'Research answer.' },
    ]);
    expect(events).toContainEqual({ type: 'status', action: 'Searching the web', query: 'Kotoamatsukami' });
    expect(events).toContainEqual({ type: 'status', action: 'Reading a source', query: 'Shisui Uchiha biography' });
    expect(events).toContainEqual({ type: 'status', action: 'Checking what the research still needs', query: '' });
    expect(events).toContainEqual({ type: 'status', action: 'Combining findings into your answer', query: '' });
    expect(events.some(event => event.type === 'error')).toBe(false);
  });
});
