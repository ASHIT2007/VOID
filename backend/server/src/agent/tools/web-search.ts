import { tavily } from '@tavily/core';
import { registerTool, ToolResult, ToolOptions } from '../tool-registry.js';

interface WebSearchArgs {
  query: string;
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeImages?: boolean;
}

type TavilyResult = { title?: string; url?: string; content?: string; score?: number };
type TavilyImage = string | { url?: string; description?: string; title?: string };

const LOW_VALUE_IMAGE = /(?:placeholder|no[-_]?image|missing|default|blank|spacer|sprite|avatar|favicon|logo|icon|pixel)/i;
const AUTHORITY_DOMAINS = /(?:\.gov|\.edu|\.ac\.|who\.int|un\.org|worldbank\.org|oecd\.org|nih\.gov|nasa\.gov|reuters\.com|apnews\.com|britannica\.com|wikipedia\.org)$/i;
const LOW_VALUE_DOMAINS = /(?:^|\.)(?:facebook|instagram|tiktok|pinterest|quora|youtube|alibaba|fandom)\.com$/i;

function boundedResults(value: number | undefined, fallback = 5): number {
  return Math.max(1, Math.min(12, Number.isFinite(value) ? Number(value) : fallback));
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

function rankAndDedupe(results: TavilyResult[], limit: number, query: string): TavilyResult[] {
  const seen = new Set<string>();
  const domainCounts = new Map<string, number>();
  return results
    .filter((result) => Boolean(result.url && result.title))
    .sort((left, right) => resultScore(right, query) - resultScore(left, query))
    .filter((result) => {
      try {
        const url = new URL(result.url!);
        const hostname = url.hostname.replace(/^www\./, '');
        if (LOW_VALUE_DOMAINS.test(hostname) || (domainCounts.get(hostname) || 0) >= 2) return false;
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
    const snippet = raw.length > snippetLimit ? `${raw.slice(0, snippetLimit)}...` : raw;
    return `[${index + 1}] ${result.title}\nURL: ${result.url}\nSnippet: ${snippet}`;
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

async function duckDuckGoToolResult(query: string, maxResults: number | undefined, advanced: boolean): Promise<ToolResult> {
  const limit = boundedResults(maxResults);
  let results: TavilyResult[] = [];
  try { results = await searchDuckDuckGoWeb(query, limit); } catch {}
  if (results.length === 0) {
    try { results = await searchBraveWeb(query, limit); } catch {}
  }
  if (results.length === 0) {
    try { results = await searchWikipediaWeb(query, limit); } catch {}
  }
  if (results.length === 0) results = await searchDuckDuckGoInstant(query, limit);
  if (results.length === 0) return { content: 'No web results found.' };
  const sources = results.map((result) => ({
    url: result.url!,
    title: result.title!,
    content: result.content || '',
  }));
  return { content: formatResults(results, advanced), sources };
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
            includeImages: { type: 'boolean', description: 'Return validated, relevant image candidates when useful.' }
          },
          required: ['query']
        }
      }
    },
    async (args: Record<string, unknown>): Promise<ToolResult> => {
      const { query, maxResults = 5, searchDepth = 'basic', includeImages = false } = args as unknown as WebSearchArgs;
      
      if (!query) {
        return { content: 'Error: query is required.', error: 'query missing' };
      }

      try {
        const apiKey = process.env.TAVILY_API_KEY;
        if (apiKey) {
          try {
            const tvly = tavily({ apiKey });
            const advanced = searchDepth === 'advanced';
            const limit = boundedResults(maxResults, advanced ? 8 : 5);
            const queries = advanced ? focusedQueries(query) : [query];
            const responses = await Promise.all(queries.map((focusedQuery) => tvly.search(focusedQuery, {
              searchDepth: advanced ? 'advanced' : 'basic',
              maxResults: advanced ? Math.min(6, limit) : limit,
              includeImages,
              includeImageDescriptions: includeImages,
            })));
            const results = rankAndDedupe(responses.flatMap((response) => (response.results || []) as TavilyResult[]), limit, query);
            if (results.length === 0) {
              return await duckDuckGoToolResult(query, maxResults, advanced);
            }
            const images = includeImages
              ? await validatedImages(responses.flatMap((response) => (response.images || []) as TavilyImage[]), query)
              : [];
            const sources = results.map((result) => ({ url: result.url!, title: result.title!, content: result.content || '' }));
            return { content: formatResults(results, advanced), images, sources };
          } catch {
            // An exhausted or temporarily unavailable paid provider must not
            // turn a healthy keyless web index into a failed search.
            return await duckDuckGoToolResult(query, maxResults, searchDepth === 'advanced');
          }
        } else {
          // The Instant Answer API is not a general web index and frequently
          // returns nothing for people, places, products, and niche entities.
          // Use the non-JavaScript result page first, retaining Instant Answer
          // only as a secondary service fallback.
          return await duckDuckGoToolResult(query, maxResults, searchDepth === 'advanced');
        }
      } catch (err: any) {
        return { content: `Error during search: ${err.message}`, error: err.message };
      }
    },
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
    async (args: Record<string, unknown>): Promise<ToolResult> => {
      const { query, maxResults = 5, searchDepth = 'advanced', includeImages = false } = args as unknown as WebSearchArgs;
      if (!query) {
        return { content: 'Error: query is required.', error: 'query missing' };
      }
      try {
        const apiKey = process.env.TAVILY_API_KEY;
        if (apiKey) {
          const tvly = tavily({ apiKey });
          const response = await tvly.search(query, { searchDepth, topic: 'news', maxResults: boundedResults(maxResults), includeImages });
          
          if (!response || !response.results || response.results.length === 0) {
            return { content: 'No news found.' };
          }
          const results = rankAndDedupe(response.results as TavilyResult[], boundedResults(maxResults), query);
          const images = includeImages ? await validatedImages((response.images || []) as TavilyImage[], query) : [];
          const sources = results.map((result) => ({ url: result.url!, title: result.title!, content: result.content || '' }));
          return { content: formatResults(results, true), images, sources };
        }
        return { content: 'Error: TAVILY_API_KEY is required for news search.', error: 'missing key' };
      } catch (err: any) {
        return { content: `Error during news search: ${err.message}`, error: err.message };
      }
    },
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
