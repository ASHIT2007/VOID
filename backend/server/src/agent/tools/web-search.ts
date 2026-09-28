import { tavily } from '@tavily/core';
import { createHash } from 'node:crypto';
import { registerTool, ToolResult, ToolOptions } from '../tool-registry.js';

interface WebSearchArgs {
  query: string;
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeImages?: boolean;
  timeRange?: 'day' | 'week' | 'month' | 'year';
  topic?: 'general' | 'news';
}

type TavilyResult = { title?: string; url?: string; content?: string; score?: number; published_date?: string; page_age?: string };
type TavilyImage = string | { url?: string; description?: string; title?: string };

const LOW_VALUE_IMAGE = /(?:placeholder|no[-_]?image|missing|default|blank|spacer|sprite|avatar|favicon|logo|icon|pixel)/i;
const AUTHORITY_DOMAINS = /(?:\.gov|\.edu|\.ac\.|who\.int|un\.org|worldbank\.org|oecd\.org|nih\.gov|nasa\.gov|reuters\.com|apnews\.com|britannica\.com|wikipedia\.org)$/i;
const LOW_VALUE_DOMAINS = /(?:^|\.)(?:facebook|instagram|tiktok|pinterest|quora|youtube|alibaba|fandom)\.com$/i;

function boundedResults(value: number | undefined, fallback = 5): number {
  return Math.max(1, Math.min(12, Number.isFinite(value) ? Number(value) : fallback));
}

export function searchFreshness(query: string, news = false): { current: boolean; timeRange?: WebSearchArgs['timeRange'] } {
  if (/\b(?:today|tonight|live|right now|latest score|current score)\b/i.test(query)) return { current: true, timeRange: 'day' };
  if (news || /\b(?:latest|current|recent|news|this week|update)\b/i.test(query)) return { current: true, timeRange: 'week' };
  if (/\b(?:next|upcoming|schedule|forecast|weather|release date)\b/i.test(query) || query.includes(String(new Date().getUTCFullYear()))) return { current: true, timeRange: 'year' };
  return { current: false };
}

function focusedQueries(query: string): string[] {
  const clean = query.replace(/\s+/g, ' ').trim();
  const year = new Date().getFullYear();
  const variants = [clean];
  if (/\b(latest|current|today|recent|news|update)\b/i.test(clean)) {
    variants.push(`${clean} ${year}`);
  } else {
    variants.push(`${clean} official source facts`);
  }
  if (/\b(compare|versus|\bvs\b)\b/i.test(clean)) variants.push(`${clean} independent comparison evidence`);
  else variants.push(`${clean} expert analysis evidence`);
  return [...new Set(variants)].slice(0, 3);
}

function resultScore(result: TavilyResult, query: string): number {
  let authority = 0;
  try {
    const hostname = new URL(result.url || '').hostname.replace(/^www\./, '');
    if (AUTHORITY_DOMAINS.test(hostname)) authority += 0.35;
    if (/^(?:docs?|developer|support)\./i.test(hostname)) authority += 0.2;
  } catch {}
  const queryWords = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
  const resultWords = `${result.title || ''} ${result.content || ''}`.toLowerCase().split(/[^a-z0-9]+/);
  const overlap = resultWords.reduce((score, word) => score + (queryWords.has(word) ? 1 : 0), 0);
  return (result.score || 0) + authority + Math.min(overlap * 0.04, 0.35) + Math.min((result.content || '').length / 5000, 0.2);
}

export function rankAndDedupe(results: TavilyResult[], limit: number, query: string): TavilyResult[] {
  const seen = new Set<string>();
  const domainCounts = new Map<string, number>();
  return results
    .filter((result) => Boolean(result.url && result.title))
    .sort((left, right) => resultScore(right, query) - resultScore(left, query))
    .filter((result) => {
      try {
        const url = new URL(result.url!);
        const hostname = url.hostname.replace(/^www\./, '');
        if (searchFreshness(query).current && /(?:^|\.)wikipedia\.org$/i.test(hostname)) return false;
        if (!['http:', 'https:'].includes(url.protocol) || LOW_VALUE_DOMAINS.test(hostname) || (domainCounts.get(hostname) || 0) >= 2) return false;
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) {
          if (/^(?:utm_|ref$|source$|campaign$)/i.test(key)) url.searchParams.delete(key);
        }
        const canonical = url.toString().replace(/\/$/, '');
        if (seen.has(canonical)) return false;
        seen.add(canonical);
        domainCounts.set(hostname, (domainCounts.get(hostname) || 0) + 1);
        result.url = canonical;
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, limit);
}

async function validatedImages(candidates: TavilyImage[], query: string, limit = 4): Promise<NonNullable<ToolResult['images']>> {
  const queryWords = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
  const normalized = candidates
    .map((candidate) => typeof candidate === 'string'
      ? { url: candidate, title: '' }
      : { url: candidate.url || '', title: candidate.description || candidate.title || '' })
    .filter((candidate) => /^https?:\/\//i.test(candidate.url) && !LOW_VALUE_IMAGE.test(candidate.url))
    .sort((left, right) => {
      const relevance = (value: { title: string }) => value.title.toLowerCase().split(/[^a-z0-9]+/).reduce((score, word) => score + (queryWords.has(word) ? 1 : 0), 0);
      return relevance(right) - relevance(left);
    });
  const seen = new Set<string>();
  const checks = await Promise.all(normalized.slice(0, 10).map(async (candidate) => {
    if (seen.has(candidate.url)) return null;
    seen.add(candidate.url);
    try {
      const response = await fetch(candidate.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8', 'User-Agent': 'VOID-Search/2.0' },
      });
      const type = response.headers.get('content-type') || '';
      const length = Number(response.headers.get('content-length') || 0);
      await response.body?.cancel();
      if (!response.ok || !type.startsWith('image/') || type.includes('svg') || (length > 0 && length < 1500)) return null;
      let sourceDomain = '';
      try { sourceDomain = new URL(candidate.url).hostname.replace(/^www\./, ''); } catch {}
      return {
        url: candidate.url,
        title: candidate.title || undefined,
        sourceDomain: sourceDomain || undefined,
        attribution: sourceDomain || 'Source website',
        query,
        verified: true,
      };
    } catch {
      return null;
    }
  }));
  const selected: NonNullable<ToolResult['images']> = [];
  const seenDomains = new Set<string>();
  for (const item of checks.filter((value): value is NonNullable<typeof value> => value !== null)) {
    let domain = '';
    try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
    if (domain && seenDomains.has(domain)) continue;
    if (domain) seenDomains.add(domain);
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
}

function formatResults(results: TavilyResult[], advanced: boolean): string {
  const snippetLimit = advanced ? 700 : 400;
  return results.map((result, index) => {
    const raw = (result.content || '').replace(/\s+/g, ' ').trim();
    let snippet = raw;
    if (raw.length > snippetLimit) {
      const candidate = raw.slice(0, snippetLimit);
      const lastPunct = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf('! '), candidate.lastIndexOf('? '));
      if (lastPunct > snippetLimit * 0.4) {
        snippet = candidate.slice(0, lastPunct + 1);
      } else {
        const lastSpace = candidate.lastIndexOf(' ');
        snippet = (lastSpace > 0 ? candidate.slice(0, lastSpace) : candidate).replace(/[,;:\-\s]+$/, '') + '...';
      }
    }
    return `[${index + 1}] ${result.title}\nURL: ${result.url}${result.published_date || result.page_age ? `\nPublished/updated: ${result.published_date || result.page_age}` : ''}\nSnippet: ${snippet}`;
  }).join('\n\n');
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return value
    .replace(/&#(x?[0-9a-f]+);/gi, (_match, code: string) => {
      const radix = code[0]?.toLowerCase() === 'x' ? 16 : 10;
      const numeric = Number.parseInt(radix === 16 ? code.slice(1) : code, radix);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : '';
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function plainHtml(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrapDuckDuckGoUrl(value: string): string {
  try {
    const decoded = decodeHtmlEntities(value);
    const parsed = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded, 'https://duckduckgo.com');
    const destination = parsed.searchParams.get('uddg');
    return destination && /^https?:\/\//i.test(destination) ? destination : parsed.toString();
  } catch {
    return '';
  }
}

/** Parse DuckDuckGo's non-JavaScript result page into attributable sources. */
export function parseDuckDuckGoHtml(html: string, limit = 5): TavilyResult[] {
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter((match) => /\bclass\s*=\s*["'][^"']*\bresult__a\b/i.test(match[1] || ''));
  const results: TavilyResult[] = [];
  for (let index = 0; index < anchors.length && results.length < boundedResults(limit); index++) {
    const attributes = anchors[index][1] || '';
    const href = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
    const url = unwrapDuckDuckGoUrl(href);
    const title = plainHtml(anchors[index][2] || '');
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const start = (anchors[index].index || 0) + anchors[index][0].length;
    const end = anchors[index + 1]?.index ?? Math.min(html.length, start + 8_000);
    const between = html.slice(start, end);
    const snippet = between.match(/<[^>]+\bclass\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || '';
    results.push({ title, url, content: plainHtml(snippet) });
  }
  return results;
}

/** Parse Brave Search's server-rendered web snippets without an API key. */
export function parseBraveSearchHtml(html: string, limit = 5): TavilyResult[] {
  const starts = [...html.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bsnippet\b[^"']*["'][^>]*\bdata-type=["']web["'][^>]*>/gi)];
  const results: TavilyResult[] = [];
  for (let index = 0; index < starts.length && results.length < boundedResults(limit); index++) {
    const start = starts[index].index || 0;
    const end = starts[index + 1]?.index ?? Math.min(html.length, start + 20_000);
    const block = html.slice(start, end);
    const url = decodeHtmlEntities(block.match(/<a\b[^>]*\bhref=["'](https?:\/\/[^"']+)["']/i)?.[1] || '');
    const title = plainHtml(block.match(/<div\b[^>]*\bclass=["'][^"']*\bsearch-snippet-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    const content = plainHtml(block.match(/<div\b[^>]*\bclass=["'][^"']*\bgeneric-snippet\b[^"']*["'][^>]*>[\s\S]*?<div\b[^>]*\bclass=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    if (title && /^https?:\/\//i.test(url)) results.push({ title, url, content });
  }
  return results;
}

async function searchDuckDuckGoWeb(query: string, limit: number): Promise<TavilyResult[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`DuckDuckGo web search failed (${response.status})`);
  return rankAndDedupe(parseDuckDuckGoHtml(await response.text(), Math.max(limit * 2, 8)), limit, query);
}

async function searchBraveWeb(query: string, limit: number): Promise<TavilyResult[]> {
  const response = await fetch(`https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`Brave web search failed (${response.status})`);
  return rankAndDedupe(parseBraveSearchHtml(await response.text(), Math.max(limit * 2, 8)), limit, query);
}

async function searchDuckDuckGoInstant(query: string, limit: number): Promise<TavilyResult[]> {
  const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return [];
  const data = await response.json() as any;
  const topics = Array.isArray(data?.RelatedTopics)
    ? data.RelatedTopics.flatMap((item: any) => item.Topics || [item])
    : [];
  return rankAndDedupe(topics.map((item: any) => ({
    title: item.Text || item.FirstURL || '',
    url: item.FirstURL || '',
    content: item.Text || '',
  })), limit, query);
}

async function searchWikipediaWeb(query: string, limit: number): Promise<TavilyResult[]> {
  const endpoint = new URL('https://en.wikipedia.org/w/api.php');
  endpoint.searchParams.set('action', 'query');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('origin', '*');
  endpoint.searchParams.set('list', 'search');
  endpoint.searchParams.set('srnamespace', '0');
  endpoint.searchParams.set('srlimit', String(Math.min(Math.max(limit, 3), 12)));
  endpoint.searchParams.set('srsearch', query);
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(8_000),
    headers: { 'User-Agent': 'VOID-WebSearch/2.0 (structured source fallback)' },
  });
  if (!response.ok) return [];
  const data = await response.json() as {
    query?: { search?: Array<{ pageid?: number; title?: string; snippet?: string }> };
  };
  return (data.query?.search || [])
    .filter((item) => Number.isFinite(item.pageid) && Boolean(item.title))
    .map((item) => ({
      title: item.title!,
      url: `https://en.wikipedia.org/?curid=${item.pageid}`,
      content: plainHtml(item.snippet || ''),
    }))
    .slice(0, limit);
}

// Circuit-break a failing API briefly instead of spending every tool deadline
// retrying a quota-exhausted account. Keys never enter logs or tool results.
const providerCooldown = new Map<string, number>();
const providerIssue = new Map<string, string>();
const providerCredentials = new Map<string, string>();
function providerAvailable(id: string): boolean {
  const credential = id === 'Tavily' ? process.env.TAVILY_API_KEY : process.env.BRAVE_API_KEY;
  const fingerprint = createHash('sha256').update(credential || '').digest('hex');
  if (providerCredentials.get(id) !== fingerprint) {
    providerCredentials.set(id, fingerprint);
    providerCooldown.delete(id); providerIssue.delete(id);
  }
  return (providerCooldown.get(id) || 0) <= Date.now();
}
function markProviderFailure(id: string, status?: number) {
  const exhausted = status === 432 || status === 433;
  providerCooldown.set(id, Date.now() + (exhausted ? 5 * 60_000 : status === 401 || status === 403 ? 60_000 : 20_000));
  providerIssue.set(id, exhausted ? `${id} search quota is exhausted.` : status === 401 || status === 403 ? `${id} search credentials were rejected.` : `${id} search is temporarily unavailable.`);
}

async function searchBraveApi(query: string, limit: number, timeRange?: WebSearchArgs['timeRange']): Promise<TavilyResult[]> {
  const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
  endpoint.searchParams.set('q', query); endpoint.searchParams.set('count', String(Math.min(20, limit * 2)));
  if (timeRange) endpoint.searchParams.set('freshness', { day: 'pd', week: 'pw', month: 'pm', year: 'py' }[timeRange]);
  const response = await fetch(endpoint, { headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_API_KEY! }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) { markProviderFailure('Brave', response.status); return []; }
  const payload = await response.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string; page_age?: string }> } };
  return (payload.web?.results || []).map(item => ({ title: item.title, url: item.url, content: plainHtml(item.description || ''), page_age: item.page_age }));
}

async function keylessWebResults(query: string, limit: number, current: boolean): Promise<TavilyResult[]> {
  const lookup = current ? `${query} -site:wikipedia.org` : query;
  const attempts = await Promise.allSettled([searchDuckDuckGoWeb(lookup, limit), searchBraveWeb(lookup, limit)]);
  return rankAndDedupe(attempts.flatMap(result => result.status === 'fulfilled' ? result.value : []), limit, current ? `latest ${query}` : query);
}

function withinFreshness(results: TavilyResult[], timeRange?: WebSearchArgs['timeRange']): TavilyResult[] {
  if (!timeRange) return results;
  const windowMs = { day: 1, week: 7, month: 31, year: 366 }[timeRange] * 86_400_000;
  return results.filter(result => {
    const date = Date.parse(result.published_date || result.page_age || '');
    // Undated primary pages can still be useful leads, but are never claimed
    // fresh just because they were retrieved today.
    return !Number.isFinite(date) || Date.now() - date <= windowMs;
  });
}

function searchResult(results: TavilyResult[], advanced: boolean, provider: string, background = false): ToolResult {
  const sources = results.map(result => ({ url: result.url!, title: result.title!, content: result.content || '' }));
  return { content: `Search provider: ${provider}. Retrieved at ${new Date().toISOString()}. ${background ? 'Only background encyclopedia information is available; current facts have NOT been verified.' : 'Use source publication/update dates to assess currency; retrieval time alone does not establish freshness.'}\n\n${formatResults(results, advanced)}`, sources };
}

export async function searchWeb(args: WebSearchArgs): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, 1000) : '';
  if (!query) return { content: 'A search query is required.', error: 'query_missing' };
  const advanced = args.searchDepth === 'advanced';
  const limit = boundedResults(args.maxResults, advanced ? 8 : 5);
  const freshness = searchFreshness(query, args.topic === 'news');
  const timeRange = args.timeRange || freshness.timeRange;
  const current = freshness.current || Boolean(args.timeRange);
  if (process.env.TAVILY_API_KEY && providerAvailable('Tavily')) {
    try {
      const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
      const queries = advanced ? focusedQueries(query).slice(0, 2) : [query];
      const attempts = await Promise.allSettled(queries.map(focusedQuery => tvly.search(focusedQuery, {
        searchDepth: advanced ? 'advanced' : 'basic', maxResults: Math.min(12, limit + 3),
        topic: args.topic || 'general', ...(timeRange ? { timeRange } : {}),
        ...(current ? { excludeDomains: ['wikipedia.org'] } : {}),
        includeImages: args.includeImages === true, includeImageDescriptions: args.includeImages === true,
        timeout: 8,
      })));
      const responses = attempts.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      const results = rankAndDedupe(withinFreshness(responses.flatMap(response => response.results || []) as TavilyResult[], timeRange), limit, current && !freshness.current ? `latest ${query}` : query);
      if (results.length) {
        providerIssue.delete('Tavily');
        const images = args.includeImages ? await validatedImages(responses.flatMap(response => response.images || []) as TavilyImage[], query) : [];
        return { ...searchResult(results, advanced, 'Tavily'), images };
      }
      const failure = attempts.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') {
        const status = Number(failure.reason?.status || failure.reason?.response?.status || String(failure.reason?.message || '').match(/\b(401|403|429|432|433|500|502|503)\b/)?.[1]) || undefined;
        markProviderFailure('Tavily', status);
      }
    } catch { markProviderFailure('Tavily'); }
  }
  if (process.env.BRAVE_API_KEY && providerAvailable('Brave')) {
    try {
      const results = rankAndDedupe(withinFreshness(await searchBraveApi(query, limit, timeRange), timeRange), limit, current && !freshness.current ? `latest ${query}` : query);
      if (results.length) return searchResult(results, advanced, 'Brave Search API');
    } catch { markProviderFailure('Brave'); }
  }
  const results = await keylessWebResults(query, limit, current);
  if (results.length) return searchResult(results, advanced, 'DuckDuckGo / Brave web index');
  const issues = [...providerIssue.values()].join(' ');
  if (current) return { content: `${issues} Fresh web results are unavailable. The requested current information could not be verified; encyclopedia pages are not a substitute for live scores, upcoming schedules or news.`, error: 'fresh_search_unavailable', sources: [] };
  let background: TavilyResult[] = [];
  try { background = await searchWikipediaWeb(query, Math.min(limit, 2)); } catch {}
  if (!background.length) { try { background = await searchDuckDuckGoInstant(query, Math.min(limit, 2)); } catch {} }
  return background.length ? searchResult(rankAndDedupe(background, Math.min(limit, 2), query), advanced, 'Encyclopedia fallback', true)
    : { content: `${issues} No attributable web results were available.`, error: 'search_unavailable', sources: [] };
}

export function registerWebSearchTools(): void {
  const options: ToolOptions = { readOnly: true, requiresConfirmation: false, category: 'retrieval' };

  // 1. web_search
  registerTool(
    'web_search',
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for current or verifiable information. Advanced depth performs multiple focused searches, deduplicates results, and ranks authoritative sources.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            maxResults: { type: 'number', description: 'Maximum number of ranked results to return (1-12, default 5)' },
            searchDepth: { type: 'string', enum: ['basic', 'advanced'], description: 'Use advanced for multi-query, deeper retrieval and source ranking.' },
            includeImages: { type: 'boolean', description: 'Return validated image candidates only for a separate approved visual request.' },
            timeRange: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Freshness window. Use day for live scores/today, week for recent news, year for upcoming schedules.' },
            topic: { type: 'string', enum: ['general', 'news'], description: 'Use news for current reporting; general for official schedules and reference facts.' }
          },
          required: ['query']
        }
      }
    },
    async (args: Record<string, unknown>): Promise<ToolResult> => searchWeb(args as unknown as WebSearchArgs),
    options
  );

  // 2. news_search
  registerTool(
    'news_search',
    {
      type: 'function',
      function: {
        name: 'news_search',
        description: 'Search the web for news.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            maxResults: { type: 'number', description: 'Maximum number of results to return (default 5)' }
          },
          required: ['query']
        }
      }
    },
    async (args: Record<string, unknown>): Promise<ToolResult> => searchWeb({ ...args, query: String(args.query || ''), topic: 'news', searchDepth: 'advanced', timeRange: 'week' } as WebSearchArgs),
    options
  );

  // 3. academic_search
  registerTool(
    'academic_search',
    {
      type: 'function',
      function: {
        name: 'academic_search',
        description: 'Search academic sources.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            maxResults: { type: 'number', description: 'Maximum number of results to return (default 5)' }
          },
          required: ['query']
        }
      }
    },
    async (args: Record<string, unknown>): Promise<ToolResult> => {
      const { query, maxResults = 5, searchDepth = 'advanced', includeImages = false } = args as unknown as WebSearchArgs;
      if (!query) {
        return { content: 'Error: query is required.', error: 'query missing' };
      }
      try {
        const apiKey = process.env.TAVILY_API_KEY;
        if (apiKey) {
          const tvly = tavily({ apiKey });
          const response = await tvly.search(query, { 
            searchDepth,
            maxResults: boundedResults(maxResults),
            includeImages,
            includeDomains: ['arxiv.org', 'scholar.google.com', 'pubmed.ncbi.nlm.nih.gov', 'semanticscholar.org', 'nature.com', 'science.org'] 
          });
          if (!response || !response.results || response.results.length === 0) {
            return { content: 'No academic results found.' };
          }
          const results = rankAndDedupe(response.results as TavilyResult[], boundedResults(maxResults), query);
          const images = includeImages ? await validatedImages((response.images || []) as TavilyImage[], query) : [];
          const sources = results.map((result) => ({ url: result.url!, title: result.title!, content: result.content || '' }));
          return { content: formatResults(results, true), images, sources };
        }
        return { content: 'Error: TAVILY_API_KEY is required for academic search.', error: 'missing key' };
      } catch (err: any) {
        return { content: `Error during academic search: ${err.message}`, error: err.message };
      }
    },
    options
  );
}

registerWebSearchTools();
