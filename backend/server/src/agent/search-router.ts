import { addSource } from './agent-session.js';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

const BLOCKED_DOMAINS = ['pinterest.com', 'quora.com', 'facebook.com', 'instagram.com', 'tiktok.com'];

/**
 * Reformulates a raw user query into 1-3 focused search queries.
 * Uses a heuristic approach to keep it fast.
 */
export async function reformulateQuery(query: string): Promise<string[]> {
  const cleanQuery = query.toLowerCase().trim();
  const words = cleanQuery.split(/\s+/);
  
  if (words.length < 6 && !cleanQuery.includes(' and ') && !cleanQuery.includes(' vs ') && !cleanQuery.includes(' compare ')) {
    return [query];
  }

  let baseQuery = cleanQuery
    .replace(/^(what (?:is|are|was|were)|tell me (?:about|more about|all about|of)|how (?:does|do|did)|can you explain|why (?:is|are|did)|who (?:is|was|are|were)|where (?:is|are))\s+/i, '')
    .trim();

  const queries: string[] = [];

  if (baseQuery.includes(' compare ') || baseQuery.includes(' vs ')) {
    const parts = baseQuery.replace(/compare /i, '').split(/\s+and\s+|\s+vs\s+/i);
    if (parts.length >= 2) {
      queries.push(`${parts[0].trim()} features`);
      queries.push(`${parts[1].trim()} features`);
      queries.push(`${parts[0].trim()} vs ${parts[1].trim()} comparison`);
      return queries.slice(0, 3);
    }
  }

  if (baseQuery.includes(' and ')) {
    const parts = baseQuery.split(/\s+and\s+/i);
    queries.push(...parts.map(p => p.trim()));
    return queries.slice(0, 3);
  }

  return [baseQuery];
}

/**
 * Deduplicates search results and removes blocked domains.
 */
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const uniqueUrls = new Set<string>();
  const filtered: SearchResult[] = [];

  for (const result of results) {
    let hostname = '';
    try {
      hostname = new URL(result.url).hostname.replace(/^www\./, '');
    } catch {
      continue; // Skip invalid URLs
    }

    if (BLOCKED_DOMAINS.some(domain => hostname.includes(domain))) {
      continue;
    }

    if (!uniqueUrls.has(result.url)) {
      uniqueUrls.add(result.url);
      filtered.push(result);
    }
  }

  return filtered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * Formats results into numbered citations and records them in the session.
 */
export function formatWithCitations(results: SearchResult[], sessionId: string): string {
  let formatted = 'Sources:\n';
  
  results.forEach((result, index) => {
    const sourceIndex = index + 1;
    addSource(sessionId, {
      index: sourceIndex,
      url: result.url,
      title: result.title,
      snippet: result.content
    });
    
    formatted += `[${sourceIndex}] ${result.title} - ${result.url}\n${result.content}\n\n`;
  });
  
  return formatted.trim();
}
