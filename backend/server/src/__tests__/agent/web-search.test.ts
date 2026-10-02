import { afterEach, describe, expect, it, vi } from 'vitest';
import { withByokContext } from '../../ai/byok-context.js';
import { getTool } from '../../agent/tool-registry.js';
import '../../agent/tools/image-search.js';
import { searchWeb, parseBraveSearchHtml, parseDuckDuckGoHtml, rankAndDedupe, searchFreshness } from '../../agent/tools/web-search.js';

const { searchMock, keys } = vi.hoisted(() => ({ searchMock: vi.fn(), keys: [] as string[] }));
vi.mock('../../lib/crypto.js', () => ({ decrypt: (encrypted: string) => encrypted }));
const credential = (providerId: 'tavily' | 'brave', encryptedKey = 'test-user-key') => ({ id: '00000000-0000-4000-8000-000000000001', providerId, encryptedKey, iv: 'iv', authTag: 'tag', priority: 0 });
const search = (userId: string, providerId: 'tavily' | 'brave', args: Parameters<typeof searchWeb>[0], encryptedKey = 'test-user-key') => withByokContext({ userId, mode: 'AUTO', models: [], searchCredentials: [credential(providerId, encryptedKey)] }, () => searchWeb(args));
vi.mock('@tavily/core', () => ({ tavily: (options: { apiKey: string }) => { keys.push(options.apiKey); return { search: searchMock }; } }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); searchMock.mockReset(); keys.length = 0; });

describe('current web retrieval and source diversity', () => {
  it('chooses appropriate windows for live results, news and future schedules', () => {
    expect(searchFreshness('India live score today').timeRange).toBe('day');
    expect(searchFreshness('latest India cricket news').timeRange).toBe('week');
    expect(searchFreshness('India next match schedule').timeRange).toBe('year');
    expect(searchFreshness('history of cricket').current).toBe(false);
  });
  it('deduplicates tracking links, limits a single domain and excludes Wikipedia from current claims', () => {
    const results = rankAndDedupe([
      { title: 'Wikipedia schedule', url: 'https://en.wikipedia.org/wiki/Cricket' },
      ...[1, 2, 3].map(i => ({ title: `Official match ${i}`, url: `https://bcci.tv/${i}` })),
      { title: 'Duplicate match', url: 'https://bcci.tv/1?utm_source=test' },
      { title: 'Independent reporting', url: 'https://reuters.com/cricket' },
    ], 5, 'India next match schedule');
    expect(results).toHaveLength(3);
    expect(results.map(item => item.url)).toContain('https://reuters.com/cricket');
    expect(results.some(item => item.url?.includes('wikipedia'))).toBe(false);
  });
  it('passes freshness to Tavily and drops stale dated and encyclopedia results', async () => {

    searchMock.mockResolvedValue({ results: [
      { title: 'Old result', url: 'https://old.example/match', published_date: '1983-10-01' },
      { title: 'Wiki', url: 'https://en.wikipedia.org/wiki/Cricket' },
      { title: 'Official fixture', url: 'https://bcci.tv/fixtures', published_date: new Date().toISOString() },
    ] });
    const result = await search('fresh-owner', 'tavily', { query: 'India next match schedule' });
    expect(searchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeRange: 'year', excludeDomains: ['wikipedia.org'], includeImages: false }));
    expect(result.sources?.map(source => source.url)).toEqual(['https://bcci.tv/fixtures']);
    expect(result.content).toContain('Published/updated:');
  });
  it('reports exhausted quota without silently substituting Wikipedia for a current answer', async () => {

    searchMock.mockRejectedValue(Object.assign(new Error('plan usage limit'), { status: 432 }));
    const fetchMock = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < 2; i++) {
      const result = await search('quota-owner', 'tavily', { query: 'India live score today' });
      expect(result.error).toBe('fresh_search_unavailable'); expect(result.sources).toEqual([]);
      expect(result.content).toContain('quota is unavailable');
    }
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('wikipedia.org/w/api.php'))).toBe(false);
  });
  it('uses Brave API freshness when Tavily is unavailable', async () => {

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ web: { results: [{ title: 'Latest official fixture', url: 'https://bcci.tv/fixtures', description: 'Fixture update', page_age: new Date().toISOString() }] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await search('brave-owner', 'brave', { query: 'cricket news', topic: 'news' });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('freshness')).toBe('pw');
    expect(result.content).toContain('Brave Search API'); expect(result.sources).toHaveLength(1);
  });
  it('retries a replacement Tavily key without inheriting the old account quota cooldown', async () => {

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    searchMock.mockRejectedValueOnce(Object.assign(new Error('plan usage limit'), { status: 432 }));
    expect((await search('replace-owner', 'tavily', { query: 'India live score today' }, 'exhausted-account-key')).error).toBe('fresh_search_unavailable');
    searchMock.mockResolvedValueOnce({ results: [{ title: 'Official live score', url: 'https://bcci.tv/live', content: 'Current match score.' }] });
    const result = await search('replace-owner', 'tavily', { query: 'India live score today' }, 'replacement-account-key');
    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(result.error).toBeUndefined();
    expect(result.sources?.[0].url).toBe('https://bcci.tv/live');
    expect(result.content).not.toContain('quota is exhausted');
  });
  it('blocks all retrieval without user search keys even when shared environment keys exist', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'shared-tavily'); vi.stubEnv('BRAVE_API_KEY', 'shared-brave');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await withByokContext({ userId: 'no-key-owner', mode: 'AUTO', models: [] }, async () => {
      expect((await searchWeb({ query: 'history of cricket' })).error).toBe('search_key_missing');
      for (const name of ['news_search', 'academic_search', 'image_search']) {
        expect((await getTool(name)!.handler({ query: 'Isaac Newton' })).error).toBe('search_key_missing');
      }
    });
    expect(searchMock).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('isolates user credentials and their quota cooldowns', async () => {
    searchMock.mockRejectedValueOnce(Object.assign(new Error('quota'), { status: 429 }));
    expect((await search('isolated-a', 'tavily', { query: 'latest news' }, 'key-a')).error).toBe('fresh_search_unavailable');
    searchMock.mockResolvedValue({ results: [{ title: 'Independent source', url: 'https://example.org/current', content: 'Updated.' }] });
    expect((await search('isolated-b', 'tavily', { query: 'latest news' }, 'key-b')).sources).toHaveLength(1);
    expect((await search('isolated-a', 'tavily', { query: 'latest news' }, 'key-a')).error).toBe('fresh_search_unavailable');
    expect(keys).toEqual(['key-a', 'key-b']);
  });
  it('fails over only to another connected user search key', async () => {
    searchMock.mockRejectedValueOnce(Object.assign(new Error('quota exhausted'), { status: 429 }));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ web: { results: [{ title: 'Search result', url: 'https://example.org/result', description: 'Verified source.' }] } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await withByokContext({ userId: 'fallback-owner', mode: 'AUTO', models: [], searchCredentials: [
      { ...credential('tavily', 'owned-tavily'), priority: 2 },
      { ...credential('brave', 'owned-brave'), id: '00000000-0000-4000-8000-000000000002', priority: 1 },
    ] }, () => searchWeb({ query: 'latest news' }));
    expect(result.error).toBeUndefined(); expect(result.sources).toHaveLength(1);
    expect(keys).toEqual(['owned-tavily']);
    expect(fetchMock.mock.calls[0][1].headers['X-Subscription-Token']).toBe('owned-brave');
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

});

describe('DuckDuckGo keyless web-search parsing', () => {
  it('returns decoded source pages and snippets from the HTML results page', () => {
    const html = `
      <div class="result results_links">
        <h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnaruto.example%2FKiller_Bee&amp;rut=abc">Killer Bee &amp; Gyuki</a></h2>
        <a class="result__snippet" href="https://naruto.example/Killer_Bee">Killer Bee is the Eight-Tails&#39; jinchuriki.</a>
      </div>
      <div class="result results_links">
        <h2><a class="result__a" href="https://example.org/second">Second source</a></h2>
        <div class="result__snippet">Independent profile and episode guide.</div>
      </div>`;

    expect(parseDuckDuckGoHtml(html, 5)).toEqual([
      {
        title: 'Killer Bee & Gyuki',
        url: 'https://naruto.example/Killer_Bee',
        content: "Killer Bee is the Eight-Tails' jinchuriki.",
      },
      {
        title: 'Second source',
        url: 'https://example.org/second',
        content: 'Independent profile and episode guide.',
      },
    ]);
  });

  it('returns source pages from Brave server-rendered snippets', () => {
    const html = `
      <div class="snippet dynamic" data-pos="0" data-type="web">
        <a href="https://naruto.example/killer-b" class="result-link">
          <div class="title search-snippet-title line-clamp-1">Killer B | Narutopedia</div>
        </a>
        <div class="generic-snippet"><div class="content desktop-default">Killer B is a shinobi from Kumogakure.</div></div>
      </div>`;

    expect(parseBraveSearchHtml(html, 5)).toEqual([{
      title: 'Killer B | Narutopedia',
      url: 'https://naruto.example/killer-b',
      content: 'Killer B is a shinobi from Kumogakure.',
    }]);
  });
});
