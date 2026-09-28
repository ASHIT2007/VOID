import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), generate: vi.fn() }));
vi.mock('@/lib/deployment-access', () => ({ requireDeploymentAccess: () => null }));
vi.mock('@/lib/reliability', () => ({ fetchWithRetry: mocks.fetch, publicServiceError: () => 'The answer did not finish. Please retry.' }));
vi.mock('@/lib/ai/server', () => ({ authenticatedUser: async () => 'user-a', loadByokContext: async () => ({ userId: 'user-a', mode: 'AUTO', models: [{ enabled: true, capabilities: { text: true } }] }), serviceDb: vi.fn() }));
vi.mock('@/lib/ai/client', () => ({ generateUserText: mocks.generate }));
import { POST } from '@/app/api/chat/route';
const prompt = 'make an chart comparing power level of ash pokemons';
const chart = { type: 'bar', title: 'Ash’s Pokémon — fan comparison', yLabel: 'Subjective battle rating (0–100)', xLabel: 'Pokémon', bars: [{ label: 'Pikachu', value: 95 }, { label: 'Charizard', value: 90 }], note: 'Illustrative fixture; rubric: depicted battle feats.' };
function fixture(text: string) {
  return new Response(`data: ${JSON.stringify({ type: 'text_delta', content: text })}\n\ndata: ${JSON.stringify({ type: 'done', fullText: text })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}
async function run(request = prompt) {
  const response = await POST(new NextRequest('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: request }], model: 'Auto' }) }));
  return (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
}
beforeEach(() => { vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service'); mocks.generate.mockReset(); mocks.fetch.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe('native chart completion', () => {
  it('repairs the screenshot request once and publishes a labeled native chart, without draft code', async () => {
    mocks.fetch.mockResolvedValue(fixture('Pokémon have no official power-level scale.\n```python\nsecret_chart_code()\n```'));
    mocks.generate.mockResolvedValue({ text: `Fan ratings based on a declared scale.\n\n\`\`\`chart\n${JSON.stringify(chart)}\n\`\`\`` });
    const output = await run();
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).artifactInstructions).toContain('clearly labeled subjective');
    const text = output.filter(event => event.type === 'text').map(event => event.content).join('');
    expect(text).toContain('```chart'); expect(text).toContain('Pikachu'); expect(text).toContain('not official statistics');
    expect(text).not.toContain('secret_chart_code');
    expect(output.some(event => event.type === 'error')).toBe(false);
    expect(output).toContainEqual({ type: 'status', action: 'Checking chart values and labels', query: '' });
  });
  it('does not repeat generation when valid alternate chart JSON is already available', async () => {
    mocks.fetch.mockResolvedValue(fixture(`Comparison.\n${JSON.stringify({ title: 'Power comparison', labels: ['Pikachu', 'Charizard'], values: [95, 90] })}`));
    const output = await run();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(output.filter(event => event.type === 'text')).toHaveLength(1);
    expect(output.find(event => event.type === 'text').content).toContain('"value":95');
  });
  it('forwards device tool requests and usage, then gives a real PPT download brief without regenerating', async () => {
    const events = [
      { type: 'tool_call', callId: 'ppt-call', name: 'generate_presentation', args: { title: 'Sales' } },
      { type: 'client_tool', requestId: 'request', token: 'token', name: 'generate_presentation', args: { title: 'Sales' } },
      { type: 'usage_record', id: 'usage', providerId: 'custom', modelId: 'model', inputTokens: 20, outputTokens: 10, estimated: false },
      { type: 'tool_result', callId: 'ppt-call', content: 'Created “Sales”, a 2-slide presentation. It covers Overview and Comparison. A real pptx file is available in the device workspace.' },
      { type: 'done', fullText: '' },
    ];
    mocks.fetch.mockResolvedValue(new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')));
    const output = await run('Create a PPTX presentation about sales');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(output.some(event => event.type === 'error')).toBe(false);
    expect(output.find(event => event.type === 'text').content).toContain('2-slide');
    expect(output.find(event => event.type === 'client_tool').name).toBe('generate_presentation');
    expect(output.find(event => event.type === 'usage_record').inputTokens).toBe(20);
  });
  it('retains a useful answer if repair fails, without leaking code or the old numeric error', async () => {
    mocks.fetch.mockResolvedValue(fixture('No official power scale exists. Pikachu has notable battle feats.\n```json\n{"title":"Broken","bars":[{"label":"Pikachu","value":"strong"}]}\n```'));
    mocks.generate.mockRejectedValue(new Error('Provider unavailable'));
    const output = await run();
    const text = output.filter(event => event.type === 'text').map(event => event.content).join('');
    expect(text).toContain('Pikachu has notable battle feats'); expect(text).toContain('reliable numeric chart');
    expect(text).not.toMatch(/```|"bars"|Please retry/);
    expect(output.some(event => event.type === 'error')).toBe(false);
  });
  it('explains missing real measurements instead of fabricating a chart or exposing repair tool payloads', async () => {
    mocks.fetch.mockResolvedValue(fixture('```chart\n{"title":"Revenue","bars":[{"label":"A","value":null}]}\n```'));
    mocks.generate.mockResolvedValue({ text: '```json\n{"type":"web_search","query":"secret"}\n```\nComparable revenue figures with dates and currency are required.' });
    const output = await run('Make a chart comparing actual revenue of A and B');
    const text = output.filter(event => event.type === 'text').map(event => event.content).join('');
    expect(text).toContain('Comparable revenue figures'); expect(text).not.toMatch(/secret|web_search|```|"value"/);
    expect(mocks.generate.mock.calls[0][1].messages[0].content).toContain('Do not invent factual measurements');
    expect(output.some(event => event.type === 'error')).toBe(false);
  });
});
