import { getTool } from './tool-registry.js';
import { deduplicateResults, type SearchResult } from './search-router.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface DeepResearchOptions {
  sessionId?: string;
  query: string;
  onEvent: (event: DeepResearchEvent) => void;
}

export type DeepResearchEvent =
  | { type: 'planning'; subQuestions: string[] }
  | { type: 'searching'; queryIndex: number; totalQueries: number; query: string }
  | { type: 'reading'; url: string; title: string }
  | { type: 'analyzing_gaps'; round: number }
  | { type: 'synthesizing' }
  | { type: 'report'; content: string; sources: { url: string; title: string }[] }
  | { type: 'error'; message: string };

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse the formatted text output from web_search into structured results.
 * Expected format per result:
 *   [N] Title
 *   URL: https://...
 *   Snippet: ...
 */
function parseSearchOutput(text: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    const titleMatch = block.match(/^\[(\d+)\]\s*(.+)/m);
    const urlMatch = block.match(/URL:\s*(\S+)/m);
    const snippetMatch = block.match(/Snippet:\s*(.+)/ms);
    if (titleMatch && urlMatch) {
      results.push({
        title: titleMatch[2].trim(),
        url: urlMatch[1].trim(),
        content: snippetMatch?.[1]?.trim() || titleMatch[2].trim(),
      });
    }
  }
  return results;
}

/**
 * Split a user query into sub-questions for deeper research.
 */
function decomposeQuery(query: string): string[] {
  const subQuestions: string[] = [];

  // Split compound queries
  const parts = query
    .split(/(?:,|\band\b|\balso\b)/i)
    .map((q) => q.trim())
    .filter((q) => q.length > 3);

  if (parts.length > 1) {
    subQuestions.push(...parts);
  } else {
    // Single topic — generate angles
    subQuestions.push(query);
    subQuestions.push(`${query} latest developments`);
    subQuestions.push(`${query} analysis`);
  }

  return subQuestions.slice(0, 5);
}

// ── Main deep research loop ─────────────────────────────────────────────

/**
 * Run the multi-step deep research process:
 * Plan → Search → Fetch → Gap analysis → Synthesize
 */
export async function runDeepResearch(options: DeepResearchOptions): Promise<void> {
  const MAX_SEARCH_CALLS = 20;
  const MAX_FETCH_CALLS = 10;

  try {
    // ── 1. Plan ─────────────────────────────────────────────────────
    const subQuestions = decomposeQuery(options.query);
    options.onEvent({ type: 'planning', subQuestions });

    const searchTool = getTool('web_search');
    const fetchTool = getTool('web_fetch');
    let searchCallCount = 0;
    let fetchCallCount = 0;
    let allResults: SearchResult[] = [];

    // ── 2. Search each sub-question ─────────────────────────────────
    for (let i = 0; i < subQuestions.length; i++) {
      if (searchCallCount >= MAX_SEARCH_CALLS) break;

      const q = subQuestions[i];
      options.onEvent({
        type: 'searching',
        queryIndex: i + 1,
        totalQueries: subQuestions.length,
        query: q,
      });

      if (searchTool) {
        try {
          const res = await searchTool.handler({ query: q, maxResults: 5 });
          searchCallCount++;
          if (res.content) {
            const parsed = parseSearchOutput(res.content);
            allResults.push(...parsed);
          }
        } catch (e) {
          console.error(`[deep-research] Search failed for "${q}":`, e);
        }
      }
    }

    allResults = deduplicateResults(allResults);

    // ── 3. Gap analysis (1 round) ───────────────────────────────────
    if (allResults.length < 3 && searchCallCount < MAX_SEARCH_CALLS) {
      options.onEvent({ type: 'analyzing_gaps', round: 1 });
      if (searchTool) {
        try {
          const res = await searchTool.handler({ query: options.query, maxResults: 8 });
          searchCallCount++;
          if (res.content) {
            const parsed = parseSearchOutput(res.content);
            allResults.push(...parsed);
          }
        } catch (e) {
          console.error('[deep-research] Gap analysis search failed:', e);
        }
        allResults = deduplicateResults(allResults);
      }
    }

    // ── 4. Fetch full content for top URLs ──────────────────────────
    const topUrls = allResults.slice(0, 5);
    const fetchedContent: { url: string; title: string; content: string }[] = [];

    for (const result of topUrls) {
      if (fetchCallCount >= MAX_FETCH_CALLS) break;

      options.onEvent({ type: 'reading', url: result.url, title: result.title });

      if (fetchTool) {
        try {
          const res = await fetchTool.handler({ url: result.url });
          fetchCallCount++;
          fetchedContent.push({
            url: result.url,
            title: result.title,
            content: res.content.slice(0, 3000), // Cap per-page content
          });
        } catch (e) {
          console.error(`[deep-research] Fetch failed for ${result.url}:`, e);
        }
      }
    }

    // ── 5. Synthesize report ────────────────────────────────────────
    options.onEvent({ type: 'synthesizing' });

    const sources = allResults.slice(0, 10).map((r) => ({ url: r.url, title: r.title }));

    let report = `# Deep Research: ${options.query}\n\n`;
    report += `## Executive Summary\n`;
    report += `This report covers ${subQuestions.length} research angles with `;
    report += `${allResults.length} sources found across ${searchCallCount} searches `;
    report += `and ${fetchCallCount} full-page reads.\n\n`;

    // One section per sub-question
    for (let i = 0; i < subQuestions.length; i++) {
      const q = subQuestions[i];
      report += `## ${q}\n\n`;

      // Find results relevant to this sub-question
      const relevant = allResults.filter(
        (r) =>
          r.title.toLowerCase().includes(q.toLowerCase().split(' ')[0]) ||
          r.content.toLowerCase().includes(q.toLowerCase().split(' ')[0]),
      );

      if (relevant.length > 0) {
        for (const r of relevant.slice(0, 3)) {
          const srcIdx = allResults.indexOf(r) + 1;
          report += `- ${r.content.slice(0, 200)} [${srcIdx}]\n`;
        }
      } else {
        report += `No specific findings for this angle.\n`;
      }
      report += '\n';
    }

    // Fetched content summaries
    if (fetchedContent.length > 0) {
      report += `## Key Source Details\n\n`;
      for (const fc of fetchedContent) {
        const srcIdx = allResults.findIndex((r) => r.url === fc.url) + 1;
        report += `### ${fc.title} [${srcIdx}]\n`;
        report += `${fc.content.slice(0, 500)}...\n\n`;
      }
    }

    // Sources table
    report += `## Sources\n\n`;
    sources.forEach((s, idx) => {
      report += `[${idx + 1}] [${s.title}](${s.url})\n`;
    });

    options.onEvent({ type: 'report', content: report, sources });
  } catch (error: any) {
    options.onEvent({
      type: 'error',
      message: error.message || 'Unknown error occurred during research',
    });
  }
}
