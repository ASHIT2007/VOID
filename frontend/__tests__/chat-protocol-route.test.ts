import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/deployment-access', () => ({ requireDeploymentAccess: () => null }));
vi.mock('@/lib/reliability', () => ({ fetchWithRetry: mocks.fetch, publicServiceError: () => 'The answer did not finish. Please retry.' }));
vi.mock('@/lib/ai/server', () => ({ authenticatedUser: async () => 'user-a', loadByokContext: mocks.load, serviceDb: vi.fn() }));
import { POST } from '@/app/api/chat/route';
const call = '```json\n{"type":"web_search","query":"Satoru Gojo Jujutsu Kaisen character overview"}\n```';
const request = (prompt: string) => new NextRequest('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], model: 'Auto' }) });
const fixture = (text: string, final = text) => {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) {
    for (const character of text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', content: character })}\n\n`));
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', fullText: final })}\n\n`)); controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
};
const events = (text: string) => text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as { type: string; content?: string; error?: string });
beforeEach(() => { vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service'); mocks.load.mockResolvedValue({ userId: 'user-a', mode: 'AUTO', models: [{ enabled: true, capabilities: { text: true } }] }); });
afterEach(() => vi.unstubAllEnvs());
describe('last boundary before user-visible SSE', () => {
  it('forwards the full orchestration team despite a device primary preference', async () => {
    const primary = '11111111-1111-4111-8111-111111111111', selected = '22222222-2222-4222-8222-222222222222';
    const roles = [{ id: 'researcher', name: 'Researcher', kind: 'researcher', modelId: primary, instruction: '' },
      { id: 'writer', name: 'Answer writer', kind: 'answer_writer', modelId: selected, instruction: '' }];
    mocks.load.mockResolvedValue({ userId: 'user-a', mode: 'AUTO', execution: { version: 1, primaryModelId: primary, roles, fallbackModelIds: [selected] },
      models: [primary, selected].map(id => ({ id, enabled: true, capabilities: { text: true, streaming: true } })) });
    mocks.fetch.mockResolvedValue(fixture('The team completed this answer.'));
    const response = await POST(new NextRequest('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({
      messages: [{ role: 'user', content: 'Compare telescope designs' }], model: 'Auto', routingOverride: selected,
    }) }));
    await response.text();
    const forwarded = JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body).byok;
    expect(forwarded.execution).toEqual({ version: 1, primaryModelId: selected, roles, fallbackModelIds: [] });
    expect(forwarded.manualModelId).toBe(selected);
  });
  it.each(['genrate a ppt about solar energy', 'Create a presentation about solar energy', 'Make a PowerPoint about solar energy and show a preview'])('sends %s through the presentation skill and preserves the preview', async prompt => {
    const preview = '```gamma-presentation\n' + JSON.stringify({ title: 'Solar energy', format: 'presentation', theme: 'academic-clean', slides: [
      { id: 'cover', slideNumber: 1, layout: 'full-bleed', title: 'Solar energy', content: {} },
      { id: 'energy', slideNumber: 2, layout: 'editorial', title: 'Solar panels', content: { bodyText: 'Solar panels convert sunlight into electricity using semiconductor materials. An inverter converts the direct current output into alternating current for local use.', bullets: ['Panel output depends on sunlight and shading.', 'Storage shifts available energy to later hours.'] } },
    ] }) + '\n```';
    mocks.fetch.mockResolvedValue(fixture(preview));
    const output = events(await (await POST(request(prompt))).text());
    const payload = JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body);
    expect(payload.artifactInstructions).toContain('[VISUAL DESIGN ENGINE DIRECTIVE]');
    expect(payload.artifactInstructions).toContain('editable in-app preview');
    const answer = output.filter(event => event.type === 'text').map(event => event.content || '').join('');
    expect(answer).toContain('```gamma-presentation'); expect(answer).not.toContain('#void-file-');
    expect(output.some(event => event.type === 'error')).toBe(false);
  });
  it('filters text deltas and the done payload while preserving the actual answer', async () => {
    mocks.fetch.mockResolvedValue(fixture(`${call}\n\nSatoru Gojo is a sorcerer.`));
    const output = events(await (await POST(request('tell me about satoru gojo'))).text());
    const text = output.filter(event => event.type === 'text').map(event => event.content || '').join('');
    expect(text.trim()).toBe('Satoru Gojo is a sorcerer.');
    expect(text).not.toMatch(/web_search|query|```|character overview/);
    expect(output.some(event => event.type === 'error')).toBe(false);
  });
  it('shows a clear failure if the upstream returns only an unexecuted operation', async () => {
    mocks.fetch.mockResolvedValue(fixture(call));
    const output = events(await (await POST(request('tell me about satoru gojo'))).text());
    expect(output.some(event => event.type === 'text')).toBe(false);
    expect(output).toContainEqual({ type: 'error', error: 'The answer did not finish. Please retry.' });
  });
  it('preserves tool JSON when the user explicitly asks to see a code example', async () => {
    mocks.fetch.mockResolvedValue(fixture(call));
    const output = events(await (await POST(request('Show an example JSON tool call for web_search'))).text());
    expect(output.filter(event => event.type === 'text').map(event => event.content || '').join('')).toBe(call);
  });
});
