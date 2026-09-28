import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBraveSearchHtml, parseDuckDuckGoHtml, rankAndDedupe, searchFreshness } from '../../agent/tools/web-search.js';

const searchMock = vi.hoisted(() => vi.fn());
vi.mock('@tavily/core', () => ({ tavily: () => ({ search: searchMock }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); searchMock.mockReset(); });

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
    vi.resetModules(); vi.stubEnv('TAVILY_API_KEY', 'test-key'); vi.stubEnv('BRAVE_API_KEY', '');
    searchMock.mockResolvedValue({ results: [
      { title: 'Old result', url: 'https://old.example/match', published_date: '1983-10-01' },
      { title: 'Wiki', url: 'https://en.wikipedia.org/wiki/Cricket' },
      { title: 'Official fixture', url: 'https://bcci.tv/fixtures', published_date: new Date().toISOString() },
    ] });
    const { searchWeb } = await import('../../agent/tools/web-search.js');
    const result = await searchWeb({ query: 'India next match schedule' });
    expect(searchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeRange: 'year', excludeDomains: ['wikipedia.org'], includeImages: false }));
    expect(result.sources?.map(source => source.url)).toEqual(['https://bcci.tv/fixtures']);
    expect(result.content).toContain('Published/updated:');
  });
  it('reports exhausted quota without silently substituting Wikipedia for a current answer', async () => {
    vi.resetModules(); vi.stubEnv('TAVILY_API_KEY', 'test-key'); vi.stubEnv('BRAVE_API_KEY', '');
    searchMock.mockRejectedValue(Object.assign(new Error('plan usage limit'), { status: 432 }));
    const fetchMock = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const { searchWeb } = await import('../../agent/tools/web-search.js');
    for (let i = 0; i < 2; i++) {
      const result = await searchWeb({ query: 'India live score today' });
      expect(result.error).toBe('fresh_search_unavailable'); expect(result.sources).toEqual([]);
      expect(result.content).toContain('quota is exhausted');
    }
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('wikipedia.org/w/api.php'))).toBe(false);
  });
  it('uses Brave API freshness when Tavily is unavailable', async () => {
    vi.resetModules(); vi.stubEnv('TAVILY_API_KEY', ''); vi.stubEnv('BRAVE_API_KEY', 'test-brave-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ web: { results: [{ title: 'Latest official fixture', url: 'https://bcci.tv/fixtures', description: 'Fixture update', page_age: new Date().toISOString() }] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { searchWeb } = await import('../../agent/tools/web-search.js');
    const result = await searchWeb({ query: 'cricket news', topic: 'news' });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('freshness')).toBe('pw');
    expect(result.content).toContain('Brave Search API'); expect(result.sources).toHaveLength(1);
  });
  it('retries a replacement Tavily key without inheriting the old account quota cooldown', async () => {
    vi.resetModules(); vi.stubEnv('TAVILY_API_KEY', 'exhausted-account-key'); vi.stubEnv('BRAVE_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    searchMock.mockRejectedValueOnce(Object.assign(new Error('plan usage limit'), { status: 432 }));
    const { searchWeb } = await import('../../agent/tools/web-search.js');
    expect((await searchWeb({ query: 'India live score today' })).error).toBe('fresh_search_unavailable');
    vi.stubEnv('TAVILY_API_KEY', 'replacement-account-key');
    searchMock.mockResolvedValueOnce({ results: [{ title: 'Official live score', url: 'https://bcci.tv/live', content: 'Current match score.' }] });
    const result = await searchWeb({ query: 'India live score today' });
    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(result.error).toBeUndefined();
    expect(result.sources?.[0].url).toBe('https://bcci.tv/live');
    expect(result.content).not.toContain('quota is exhausted');
  });
  it('marks encyclopedia-only results as background for stable queries', async () => {
    vi.resetModules(); vi.stubEnv('TAVILY_API_KEY', ''); vi.stubEnv('BRAVE_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn(async (url) => String(url).includes('wikipedia.org/w/api.php')
      ? new Response(JSON.stringify({ query: { search: [{ pageid: 1, title: 'Cricket', snippet: 'Cricket history.' }, { pageid: 2, title: 'Cricket history', snippet: 'Historical background.' }, { pageid: 3, title: 'Cricket rules', snippet: 'Rules.' }] } }))
      : new Response('', { status: 503 })));
    const { searchWeb } = await import('../../agent/tools/web-search.js');
    const result = await searchWeb({ query: 'history of cricket' });
    expect(result.content).toContain('Encyclopedia fallback'); expect(result.content).toContain('current facts have NOT been verified');
    expect(result.sources).toHaveLength(2);
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
