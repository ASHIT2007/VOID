import { registerTool, type ToolImage, type ToolResult, type ToolOptions } from '../tool-registry.js';
import { userSearchCredentials, searchCredentialAvailable, openSearchCredential, markSearchFailure, markSearchSuccess } from '../../ai/search-credentials.js';

interface ImageSearchArgs {
  query: string;
  maxResults?: number;
}

type WikimediaImageInfo = {
  thumburl?: string;
  url?: string;
  descriptionurl?: string;
  mime?: string;
  width?: number;
  height?: number;
};

type WikipediaArticle = {
  pageid?: number;
  index?: number;
  title?: string;
  fullurl?: string;
  thumbnail?: { source?: string; width?: number; height?: number };
  original?: { source?: string; width?: number; height?: number };
  images?: Array<{ title?: string }>;
};

type FandomArticle = {
  pageid?: number;
  title?: string;
  fullurl?: string;
  thumbnail?: { source?: string; width?: number; height?: number };
  original?: { source?: string; width?: number; height?: number };
};

type DuckDuckGoImage = {
  image?: string;
  thumbnail?: string;
  title?: string;
  url?: string;
  source?: string;
  width?: number;
  height?: number;
};

type DuckDuckGoCandidate = ToolImage & {
  fallbackUrl?: string;
};

type BraveImageCandidate = ToolImage & {
  fallbackUrl?: string;
};

const SEARCH_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

function hostname(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
}

async function verifyImageUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(3_500),
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
        'User-Agent': 'VOID-MediaVerifier/1.0',
      },
    });
    const contentType = response.headers.get('content-type') || '';
    const contentLength = Number(response.headers.get('content-length') || 0);
    await response.body?.cancel();
    return response.ok
      && contentType.startsWith('image/')
      && !contentType.includes('svg')
      && (contentLength === 0 || contentLength >= 1_500);
  } catch {
    return false;
  }
}

export function mapDuckDuckGoImages(results: DuckDuckGoImage[], query: string, limit: number): DuckDuckGoCandidate[] {
  const seen = new Set<string>();
  return results
    .filter((item) => {
      const image = item.image || '';
      if (!/^https?:\/\//i.test(image) || !item.title?.trim() || !/^https?:\/\//i.test(item.url || '')) return false;
      if ((item.width || 0) > 0 && (item.height || 0) > 0 && ((item.width || 0) < 240 || (item.height || 0) < 160)) return false;
      if (seen.has(image)) return false;
      seen.add(image);
      return true;
    })
    .slice(0, Math.min(Math.max(limit * 3, 10), 24))
    .map((item, index) => ({
      url: item.image!,
      title: item.title!.trim(),
      sourceUrl: item.url,
      sourceDomain: hostname(item.url || item.image || ''),
      attribution: item.source || hostname(item.url || '') || 'Source website',
      query,
      width: Number(item.width) || undefined,
      height: Number(item.height) || undefined,
      score: Math.max(0.55, 0.84 - index * 0.015),
      fallbackUrl: /^https?:\/\//i.test(item.thumbnail || '') && item.thumbnail !== item.image
        ? item.thumbnail
        : undefined,
    }));
}

async function searchDuckDuckGoImages(query: string, limit: number): Promise<ToolResult> {
  const landing = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
    signal: AbortSignal.timeout(6_000),
    headers: SEARCH_BROWSER_HEADERS,
  });
  if (!landing.ok) throw new Error(`DuckDuckGo image search initialization failed (${landing.status})`);
  const html = await landing.text();
  const token = html.match(/vqd[^0-9-]+([0-9-]+)/)?.[1];
  if (!token) throw new Error('DuckDuckGo image search token unavailable');

  const endpoint = new URL('https://duckduckgo.com/i.js');
  endpoint.searchParams.set('l', 'us-en');
  endpoint.searchParams.set('o', 'json');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('vqd', token);
  endpoint.searchParams.set('f', ',,,,,');
  endpoint.searchParams.set('p', '1');
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(8_000),
    headers: { ...SEARCH_BROWSER_HEADERS, Referer: 'https://duckduckgo.com/' },
  });
  if (!response.ok) throw new Error(`DuckDuckGo image search failed (${response.status})`);
  const data = await response.json() as { results?: DuckDuckGoImage[] };
  // Validate a bounded candidate pool. Publisher CDNs frequently reject
  // hotlinks even though DuckDuckGo has a healthy cached thumbnail, so test
  // both URLs in parallel and retain that thumbnail as the display fallback.
  // This avoids both the all-or-nothing failure and dozens of five-second
  // requests on a single media turn.
  const mapped = mapDuckDuckGoImages(data.results || [], query, limit)
    .slice(0, Math.min(Math.max(limit + 2, 6), 10));
  const checked = await Promise.all(mapped.map(async ({ fallbackUrl, ...image }) => {
    const [originalWorks, fallbackWorks] = await Promise.all([
      verifyImageUrl(image.url),
      fallbackUrl ? verifyImageUrl(fallbackUrl) : Promise.resolve(false),
    ]);
    if (originalWorks) return { ...image, verified: true };
    if (fallbackWorks && fallbackUrl) {
      return {
        ...image,
        url: fallbackUrl,
        // DDG reports dimensions for the original, not its cached thumbnail.
        width: undefined,
        height: undefined,
        verified: true,
      };
    }
    return null;
  }));
  const images = checked.filter((image): image is NonNullable<typeof image> => image !== null).slice(0, limit);
  if (images.length === 0) return { content: 'No validated general web images found.' };
  return {
    content: `Found ${images.length} validated general web images:\n\n${images.map((image, index) => (
      `[${index + 1}] Title: ${image.title}\nURL: ${image.url}\nSource page: ${image.sourceUrl}\nAttribution: ${image.attribution}`
    )).join('\n\n')}`,
    images,
  };
}

function decodeJavaScriptString(value: string): string {
  try { return JSON.parse(`"${value}"`) as string; } catch { return value.replace(/\\\//g, '/'); }
}

/** Parse the image records embedded in Brave's server-rendered search page. */
export function parseBraveImageHtml(html: string, query: string, limit: number): BraveImageCandidate[] {
  const pattern = /\{title:"((?:\\.|[^"\\])*)",url:"((?:\\.|[^"\\])*)"[\s\S]{0,5000}?thumbnail:\{src:"((?:\\.|[^"\\])*)"[\s\S]{0,1600}?properties:\{url:"((?:\\.|[^"\\])*)",resized:"((?:\\.|[^"\\])*)"[\s\S]{0,1000}?height:(\d+),width:(\d+)/g;
  const seen = new Set<string>();
  const candidates: BraveImageCandidate[] = [];
  for (const match of html.matchAll(pattern)) {
    const [title, sourceUrl, thumbnail, original, resized] = match.slice(1, 6).map(decodeJavaScriptString);
    const height = Number(match[6]);
    const width = Number(match[7]);
    if (!title || !/^https?:\/\//i.test(sourceUrl) || !/^https?:\/\//i.test(original) || seen.has(original)) continue;
    if (width > 0 && height > 0 && (width < 240 || height < 160)) continue;
    seen.add(original);
    candidates.push({
      url: original,
      fallbackUrl: /^https?:\/\//i.test(resized) ? resized : thumbnail,
      title,
      sourceUrl,
      sourceDomain: hostname(sourceUrl),
      attribution: hostname(sourceUrl) || 'Source website',
      query,
      width: width || undefined,
      height: height || undefined,
      score: Math.max(0.58, 0.86 - candidates.length * 0.015),
    });
    if (candidates.length >= Math.min(Math.max(limit + 2, 6), 10)) break;
  }
  return candidates;
}

async function searchBraveImages(query: string, limit: number): Promise<ToolResult> {
  const response = await fetch(`https://search.brave.com/images?q=${encodeURIComponent(query)}&source=web`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    headers: SEARCH_BROWSER_HEADERS,
  });
  if (!response.ok) throw new Error(`Brave image search failed (${response.status})`);
  const candidates = parseBraveImageHtml(await response.text(), query, limit);
  const checked = await Promise.all(candidates.map(async ({ fallbackUrl, ...image }) => {
    const [originalWorks, fallbackWorks] = await Promise.all([
      verifyImageUrl(image.url),
      fallbackUrl ? verifyImageUrl(fallbackUrl) : Promise.resolve(false),
    ]);
    if (originalWorks) return { ...image, verified: true };
    if (fallbackWorks && fallbackUrl) return { ...image, url: fallbackUrl, width: undefined, height: undefined, verified: true };
    return null;
  }));
  const images = checked.filter((image): image is NonNullable<typeof image> => image !== null).slice(0, limit);
  if (images.length === 0) return { content: 'No validated Brave web images found.' };
  return {
    content: `Found ${images.length} validated Brave web images:\n\n${images.map((image, index) => (
      `[${index + 1}] Title: ${image.title}\nURL: ${image.url}\nSource page: ${image.sourceUrl}\nAttribution: ${image.attribution}`
    )).join('\n\n')}`,
    images,
  };
}

const FANDOM_WIKIS: Array<{ pattern: RegExp; host: string; label: string }> = [
  { pattern: /\bnaruto\b/i, host: 'naruto.fandom.com', label: 'Narutopedia' },
  { pattern: /\bone piece\b/i, host: 'onepiece.fandom.com', label: 'One Piece Wiki' },
  { pattern: /\bstar wars\b/i, host: 'starwars.fandom.com', label: 'Wookieepedia' },
  { pattern: /\bharry potter\b/i, host: 'harrypotter.fandom.com', label: 'Harry Potter Wiki' },
  { pattern: /\bgame of thrones\b|\ba song of ice and fire\b/i, host: 'gameofthrones.fandom.com', label: 'Game of Thrones Wiki' },
  { pattern: /\bgenshin(?: impact)?\b/i, host: 'genshin-impact.fandom.com', label: 'Genshin Impact Wiki' },
  { pattern: /\bfortnite\b/i, host: 'fortnite.fandom.com', label: 'Fortnite Wiki' },
  { pattern: /\bmarvel\b/i, host: 'marvel.fandom.com', label: 'Marvel Database' },
  { pattern: /\bdc comics?\b|\bdc universe\b/i, host: 'dc.fandom.com', label: 'DC Database' },
];

function conciseFandomQuery(query: string, franchisePattern: RegExp): string {
  return conciseWikipediaQuery(query)
    .replace(franchisePattern, ' ')
    .replace(/\b(?:anime|character|manga|series|wiki)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() || conciseWikipediaQuery(query);
}

async function searchFandomImages(query: string, limit: number): Promise<ToolResult> {
  const wiki = FANDOM_WIKIS.find((candidate) => candidate.pattern.test(query));
  if (!wiki) return { content: 'No matching franchise image source.' };
  const endpoint = new URL(`https://${wiki.host}/api.php`);
  endpoint.searchParams.set('action', 'query');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('origin', '*');
  endpoint.searchParams.set('generator', 'search');
  endpoint.searchParams.set('gsrnamespace', '0');
  endpoint.searchParams.set('gsrlimit', String(Math.min(Math.max(limit * 2, 5), 12)));
  endpoint.searchParams.set('gsrsearch', conciseFandomQuery(query, wiki.pattern));
  endpoint.searchParams.set('prop', 'pageimages|info');
  endpoint.searchParams.set('piprop', 'thumbnail|original');
  endpoint.searchParams.set('pithumbsize', '1600');
  endpoint.searchParams.set('inprop', 'url');
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(9_000),
    headers: { 'User-Agent': 'VOID-MediaSearch/2.0 (franchise source fallback)' },
  });
  if (!response.ok) throw new Error(`${wiki.label} image search failed (${response.status})`);
  const data = await response.json() as { query?: { pages?: Record<string, FandomArticle> } };
  const candidates = Object.values(data.query?.pages || {})
    .filter((page) => Boolean(page.title && page.fullurl && (page.thumbnail?.source || page.original?.source)))
    .slice(0, Math.min(limit * 2, 10));
  const checked = await Promise.all(candidates.map(async (page, index) => {
    const thumbnail = page.thumbnail?.source || '';
    const original = page.original?.source || thumbnail;
    const [originalWorks, thumbnailWorks] = await Promise.all([
      original ? verifyImageUrl(original) : Promise.resolve(false),
      thumbnail && thumbnail !== original ? verifyImageUrl(thumbnail) : Promise.resolve(false),
    ]);
    const url = originalWorks ? original : thumbnailWorks ? thumbnail : '';
    if (!url) return null;
    return {
      url,
      title: `${page.title} — ${wiki.label}`,
      sourceUrl: page.fullurl,
      sourceDomain: wiki.host,
      attribution: wiki.label,
      query,
      width: originalWorks ? page.original?.width : page.thumbnail?.width,
      height: originalWorks ? page.original?.height : page.thumbnail?.height,
      score: Math.max(0.72, 0.92 - index * 0.025),
      verified: true,
    };
  }));
  const images = checked.filter((image): image is NonNullable<typeof image> => image !== null).slice(0, limit);
  if (images.length === 0) return { content: `No verified ${wiki.label} images found.` };
  return {
    content: `Found ${images.length} verified ${wiki.label} images:\n\n${images.map((image, index) => (
      `[${index + 1}] Title: ${image.title}\nURL: ${image.url}\nSource page: ${image.sourceUrl}\nAttribution: ${image.attribution}`
    )).join('\n\n')}`,
    images,
  };
}

async function searchCommonsImages(query: string, limit: number): Promise<ToolResult> {
  const apiUrl = new URL('https://commons.wikimedia.org/w/api.php');
  apiUrl.searchParams.set('action', 'query');
  apiUrl.searchParams.set('format', 'json');
  apiUrl.searchParams.set('origin', '*');
  apiUrl.searchParams.set('generator', 'search');
  apiUrl.searchParams.set('gsrnamespace', '6');
  apiUrl.searchParams.set('gsrlimit', String(Math.min(Math.max(limit * 2, 8), 24)));
  apiUrl.searchParams.set('gsrsearch', query);
  apiUrl.searchParams.set('prop', 'imageinfo');
  apiUrl.searchParams.set('iiprop', 'url|mime|size');
  apiUrl.searchParams.set('iiurlwidth', '1600');

  const response = await fetch(apiUrl, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'VOID-MediaSearch/2.0 (verified Wikimedia fallback)' },
  });
  if (!response.ok) throw new Error(`Wikimedia image search failed (${response.status})`);

  const data = await response.json() as {
    query?: { pages?: Record<string, { title?: string; imageinfo?: WikimediaImageInfo[] }> };
  };
  const candidates = Object.values(data.query?.pages || {})
    .flatMap((page) => (page.imageinfo || []).map((info) => ({ page, info })))
    .filter(({ info }) => info.mime?.startsWith('image/') && info.mime !== 'image/svg+xml')
    .sort((left, right) => ((right.info.width || 0) * (right.info.height || 0)) - ((left.info.width || 0) * (left.info.height || 0)))
    .slice(0, Math.min(limit * 2, 16));

  const checked = await Promise.all(candidates.map(async ({ page, info }) => {
    const url = info.thumburl || info.url || '';
    if (!url || !(await verifyImageUrl(url))) return null;
    const title = (page.title || 'Wikimedia Commons image').replace(/^File:/i, '').trim();
    return {
      url,
      title,
      mimeType: info.mime,
      sourceUrl: info.descriptionurl,
      sourceDomain: 'commons.wikimedia.org',
      attribution: 'Wikimedia Commons',
      query,
      width: info.width,
      height: info.height,
      score: 0.75,
      verified: true,
    };
  }));
  const images = checked.filter((image): image is NonNullable<typeof image> => image !== null).slice(0, limit);
  if (images.length === 0) return { content: 'No verified Wikimedia images found.' };
  return {
    content: `Found ${images.length} verified Wikimedia Commons images:\n\n${images.map((image, index) => (
      `[${index + 1}] Title: ${image.title}\nURL: ${image.url}\nSource page: ${image.sourceUrl || 'https://commons.wikimedia.org'}\nAttribution: ${image.attribution}`
    )).join('\n\n')}`,
    images,
  };
}

const WIKIPEDIA_FILE_NOISE = /(?:commons-logo|wikipe-tan|oojs|symbol[-_ ]|edit[-_ ]icon|question_book|stub icon|semi-protection|lock-green|featured article|portal-puzzle|crystal clear)/i;
const GENERIC_ARTICLE_TERMS = new Set([
  'about', 'article', 'characters', 'episode', 'history', 'introduction', 'list',
  'overview', 'series', 'the',
]);

function conciseWikipediaQuery(query: string): string {
  return query
    .replace(/\s+(?:portrait face|full body|action scene|clear overview|close up detail|full view context|labeled diagram|technical schematic|architecture overview|official artwork|official photo|exterior side view|design details|reference image)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedFileName(value: string): string {
  return value
    .replace(/^File:/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function relevantArticleFile(fileTitle: string, articleTitle: string): boolean {
  if (WIKIPEDIA_FILE_NOISE.test(fileTitle) || /\.svg$/i.test(fileTitle)) return false;
  const fileWords = new Set(normalizedFileName(fileTitle).split(/\s+/).filter(Boolean));
  const articleTerms = articleTitle.toLowerCase().split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !GENERIC_ARTICLE_TERMS.has(term));
  const matches = articleTerms.filter((term) => fileWords.has(term));
  // A single shared word is unsafe for multi-word entities: the Naruto article
  // also links to Naruto-whirlpool photography. Requiring two identity terms
  // keeps Naruto Uzumaki artwork while rejecting that homonym.
  return matches.length >= Math.min(2, articleTerms.length);
}

async function searchWikipediaArticleImages(query: string, limit: number): Promise<ToolResult> {
  const searchQuery = conciseWikipediaQuery(query);
  if (!searchQuery) return { content: 'No usable Wikipedia subject query.' };

  const searchUrl = new URL('https://en.wikipedia.org/w/api.php');
  searchUrl.searchParams.set('action', 'query');
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('origin', '*');
  searchUrl.searchParams.set('generator', 'search');
  searchUrl.searchParams.set('gsrnamespace', '0');
  searchUrl.searchParams.set('gsrlimit', '3');
  searchUrl.searchParams.set('gsrsearch', searchQuery);
  searchUrl.searchParams.set('prop', 'info|pageimages|images');
  searchUrl.searchParams.set('inprop', 'url');
  searchUrl.searchParams.set('piprop', 'thumbnail|original');
  searchUrl.searchParams.set('pithumbsize', '1400');
  searchUrl.searchParams.set('imlimit', '40');

  const searchResponse = await fetch(searchUrl, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'VOID-MediaSearch/3.0 (verified Wikipedia article fallback)' },
  });
  if (!searchResponse.ok) throw new Error(`Wikipedia article search failed (${searchResponse.status})`);
  const searchData = await searchResponse.json() as { query?: { pages?: Record<string, WikipediaArticle> } };
  const articles = Object.values(searchData.query?.pages || {})
    .filter((article) => article.title && article.fullurl)
    .sort((left, right) => (left.index || 999) - (right.index || 999));
  if (articles.length === 0) return { content: 'No matching Wikipedia article found.' };

  const directCandidates = articles.flatMap((article) => {
    const image = article.thumbnail || article.original;
    if (!image?.source) return [];
    return [{
      url: image.source,
      title: article.title || searchQuery,
      sourceUrl: article.fullurl,
      sourceDomain: 'en.wikipedia.org',
      attribution: 'Wikipedia page image',
      query,
      width: image.width,
      height: image.height,
      score: 0.9,
    } satisfies ToolImage];
  });

  const fileOwners = new Map<string, WikipediaArticle>();
  for (const article of articles) {
    for (const image of article.images || []) {
      const fileTitle = image.title || '';
      if (fileTitle && relevantArticleFile(fileTitle, article.title || '')) fileOwners.set(fileTitle, article);
    }
  }

  const fileTitles = [...fileOwners.keys()].slice(0, Math.min(Math.max(limit * 3, 8), 24));
  const fileCandidates: ToolImage[] = [];
  if (fileTitles.length > 0) {
    const fileUrl = new URL('https://en.wikipedia.org/w/api.php');
    fileUrl.searchParams.set('action', 'query');
    fileUrl.searchParams.set('format', 'json');
    fileUrl.searchParams.set('origin', '*');
    fileUrl.searchParams.set('prop', 'imageinfo');
    fileUrl.searchParams.set('iiprop', 'url|mime|size');
    fileUrl.searchParams.set('iiurlwidth', '1600');
    fileUrl.searchParams.set('titles', fileTitles.join('|'));
    const fileResponse = await fetch(fileUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'VOID-MediaSearch/3.0 (verified Wikipedia article fallback)' },
    });
    if (fileResponse.ok) {
      const fileData = await fileResponse.json() as {
        query?: { pages?: Record<string, { title?: string; imageinfo?: WikimediaImageInfo[] }> };
      };
      for (const page of Object.values(fileData.query?.pages || {})) {
        const owner = page.title ? fileOwners.get(page.title) : undefined;
        const info = page.imageinfo?.[0];
        const url = info?.thumburl || info?.url;
        if (!owner || !url || !info?.mime?.startsWith('image/') || info.mime === 'image/svg+xml') continue;
        fileCandidates.push({
          url,
          title: `${owner.title} — ${normalizedFileName(page.title || '')}`,
          mimeType: info.mime,
          sourceUrl: owner.fullurl,
          sourceDomain: 'en.wikipedia.org',
          attribution: 'Wikipedia page image',
          query,
          width: info.width,
          height: info.height,
          score: 0.86,
        });
      }
    }
  }

  const candidates = [...directCandidates, ...fileCandidates].slice(0, Math.min(limit * 2, 12));
  const checked = await Promise.all(candidates.map(async (candidate) => (
    await verifyImageUrl(candidate.url) ? { ...candidate, verified: true } : null
  )));
  const images = checked.filter((image): image is NonNullable<typeof image> => image !== null).slice(0, limit);
  if (images.length === 0) return { content: 'No verified Wikipedia article images found.' };
  return {
    content: `Found ${images.length} verified Wikipedia article images:\n\n${images.map((image, index) => (
      `[${index + 1}] Title: ${image.title}\nURL: ${image.url}\nSource page: ${image.sourceUrl}\nAttribution: ${image.attribution}`
    )).join('\n\n')}`,
    images,
  };
}

async function searchWikimediaImages(query: string, limit: number): Promise<ToolResult> {
  const [commons, wikipedia] = await Promise.allSettled([
    searchCommonsImages(query, limit),
    cachedWikipediaImages(query, limit),
  ]);
  // The subject article's lead image is usually more relevant than a broad
  // Commons filename match. Do not let Commons fill the cap before it is seen.
  const results = [wikipedia, commons]
    .filter((result): result is PromiseFulfilledResult<ToolResult> => result.status === 'fulfilled')
    .map((result) => result.value);
  const images = [...new Map(results.flatMap((result) => result.images || []).map((image) => [image.url, image])).values()]
    .slice(0, limit);
  if (images.length === 0) return { content: 'No verified Wikimedia or Wikipedia images found.' };
  return {
    content: results.map((result) => result.content).filter(Boolean).join('\n\n'),
    images,
  };
}

async function searchKeylessImages(query: string, limit: number): Promise<ToolResult> {
  const settled = await Promise.allSettled([
    searchWikimediaImages(query, Math.min(limit, 6)),
    searchDuckDuckGoImages(query, Math.min(limit, 8)),
    searchBraveImages(query, Math.min(limit, 8)),
    searchFandomImages(query, Math.min(limit, 6)),
  ]);
  const results = settled
    .filter((result): result is PromiseFulfilledResult<ToolResult> => result.status === 'fulfilled')
    .map((result) => result.value);
  const images = [...new Map(
    results.flatMap((result) => result.images || []).map((image) => [image.url, image]),
  ).values()].slice(0, limit);
  if (images.length === 0) {
    const errors = settled
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    return { content: 'No validated web images found.', error: errors.join('; ') || undefined };
  }
  return {
    content: results.map((result) => result.content).filter(Boolean).join('\n\n'),
    images,
  };
}

const wikipediaCache = new Map<string, { expires: number; result: Promise<ToolResult> }>();
async function cachedWikipediaImages(query: string, limit: number): Promise<ToolResult> {
  const subject = conciseWikipediaQuery(query);
  const key = `${subject.toLowerCase()}:${limit}`;
  let cached = wikipediaCache.get(key);
  if (!cached || cached.expires < Date.now()) {
    for (const [cacheKey, entry] of wikipediaCache) if (entry.expires < Date.now()) wikipediaCache.delete(cacheKey);
    if (wikipediaCache.size >= 80) wikipediaCache.delete(wikipediaCache.keys().next().value!);
    const result = searchWikipediaArticleImages(subject, limit).catch(() => ({ content: 'Wikipedia image search unavailable.' }));
    cached = { expires: Date.now() + 5 * 60 * 1000, result };
    wikipediaCache.set(key, cached);
  }
  const result = await cached.result;
  return { ...result, images: result.images?.map((image) => ({ ...image, query })) };
}

export function registerImageSearchTools(): void {
  const options: ToolOptions = { readOnly: true, requiresConfirmation: false, category: 'retrieval' };

  registerTool(
    'image_search',
    {
      type: 'function',
      function: {
        name: 'image_search',
        description: 'Search for images on the web.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            maxResults: { type: 'number', description: 'Maximum results (default 5)' }
          },
          required: ['query']
        }
      }
    },
    async (args: Record<string, unknown>): Promise<ToolResult> => {
      const { query, maxResults = 5 } = args as unknown as ImageSearchArgs;
      if (!userSearchCredentials().length) return { content: 'Connect a search key in AI Providers → Web search to look up web images.', error: 'search_key_missing', images: [] };
      
      if (!query) {
        return { content: 'Error: query is required.', error: 'query missing' };
      }

      try {
        const credentials = userSearchCredentials('brave').filter(searchCredentialAvailable);
        const limit = Math.max(3, Math.min(Number(maxResults) || 6, 12));
        if (!credentials.length) return { content: 'No connected Brave image-search key is available.', error: 'image_search_unavailable', images: [] };
        let res: Response | undefined;
        for (const credential of credentials) {
          try {
            const response = await fetch(`https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(String(query).slice(0, 600))}&count=${limit}&safesearch=strict`, {
          signal: AbortSignal.timeout(10_000),
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': openSearchCredential(credential)
          }
            });
            if (!response.ok) { markSearchFailure(credential, response.status); await response.body?.cancel(); continue; }
            markSearchSuccess(credential); res = response; break;
          } catch { markSearchFailure(credential); }
        }
        if (!res) return { content: 'Connected image-search keys are unavailable. Check your search settings.', error: 'image_search_unavailable', images: [] };

        const data = await res.json() as any;
        if (!data.results || data.results.length === 0) return { content: 'No images were returned by the connected search provider.', images: [] };

        // Brave safe-search is only the first layer. The media orchestrator
        // performs the product-specific policy and relevance filtering before
        // any image is emitted to the UI.
        const validImages = data.results.filter((img: any) => {
          return img.properties && img.properties.url && 
                 img.thumbnail && img.thumbnail.src &&
                 /^https?:\/\//i.test(img.properties.url);
        });

        const checkedImages = await Promise.all(validImages.slice(0, limit).map(async (img: any) => {
          const original = await verifyImageUrl(img.properties.url);
          if (original) return { img, verified: true };
          // Publisher hotlink restrictions need not discard a valid search
          // thumbnail. Preserve the publisher attribution and verified pixels.
          const thumbnail = img.thumbnail?.src;
          const verified = /^https?:\/\//i.test(thumbnail || '') && await verifyImageUrl(thumbnail);
          return { img: verified ? { ...img, properties: { ...img.properties, url: thumbnail, width: img.thumbnail.width, height: img.thumbnail.height } } : img, verified };
        }));
        const limitedImages = checkedImages.filter((candidate) => candidate.verified).map((candidate) => candidate.img);

        const braveImages: ToolImage[] = limitedImages.map((img: any) => ({
          url: img.properties.url,
          title: img.title || 'Image',
          mimeType: img.properties.format ? `image/${String(img.properties.format).toLowerCase()}` : undefined,
          sourceUrl: /^https?:\/\//i.test(img.url || '') ? img.url : undefined,
          sourceDomain: hostname(img.url || img.properties.url),
          attribution: typeof img.source === 'string' ? img.source : undefined,
          query,
          width: Number(img.properties.width) || undefined,
          height: Number(img.properties.height) || undefined,
          score: Number(img.score) || undefined,
          verified: true,
        }));

        const imagesToReturn = [...new Map(
          braveImages.map((image) => [image.url, image]),
        ).values()];
        const textContent = imagesToReturn.map((image, i) =>
          `[${i + 1}] Title: ${image.title || 'Image'}\nURL: ${image.url}\nSource page: ${image.sourceUrl || 'Unavailable'}\nAttribution: ${image.attribution || 'Source website'}`
        ).join('\n\n');

        if (imagesToReturn.length === 0) return { content: 'No usable images were returned by the connected search provider.', images: [] };
        return { 
          content: `Found ${imagesToReturn.length} images:\n\n${textContent}`,
          images: imagesToReturn
        };
      } catch {
        return { content: 'The connected image search could not finish.', error: 'image_search_unavailable', images: [] };
      }
    },
    options
  );
}

registerImageSearchTools();
