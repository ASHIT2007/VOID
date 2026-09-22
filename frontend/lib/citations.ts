type CitationContext = {
  sources?: string[];
  webSearch?: { results?: Array<{ url?: string }> };
};

type MarkdownCitation = {
  full: string;
  label: string;
  url: string;
  domain: string;
};

function sourceDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Keeps citations out of prose by moving one unique source to the end of each
 * paragraph. A source domain is shown at most once across the whole answer.
 */
export function placeCitationsAtParagraphEnds(markdown: string, context: CitationContext): string {
  const knownDomains = new Set([
    ...(context.webSearch?.results || []).map((result) => result.url || ""),
    ...(context.sources || []),
  ].map(sourceDomain).filter(Boolean));
  const usedDomains = new Set<string>();
  let insideFence = false;

  return markdown.split(/(\n{2,})/).map((block) => {
    if (/^\n{2,}$/.test(block)) return block;
    const fenceCount = (block.match(/```/g) || []).length;
    if (insideFence) {
      if (fenceCount % 2 === 1) insideFence = false;
      return block;
    }
    if (fenceCount > 0) {
      if (fenceCount % 2 === 1) insideFence = true;
      return block;
    }

    const citations: MarkdownCitation[] = [];
    const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    for (const match of block.matchAll(linkPattern)) {
      const domain = sourceDomain(match[2]);
      const numeric = /^\s*\d+\s*$/.test(match[1]);
      if (domain && (numeric || knownDomains.has(domain))) {
        citations.push({ full: match[0], label: match[1].trim(), url: match[2], domain });
      }
    }
    if (citations.length === 0) return block;

    const citationTokens = new Set(citations.map((citation) => citation.full));
    const cleaned = block
      .replace(linkPattern, (full) => citationTokens.has(full) ? "" : full)
      .replace(/[ \t]+([,.;:!?])/g, "$1")
      .replace(/,\s*([.!?])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trimEnd();
    const chosen = citations.find((citation) => !usedDomains.has(citation.domain));
    if (!chosen) return cleaned;

    usedDomains.add(chosen.domain);
    return `${cleaned} [${chosen.label}](${chosen.url})`;
  }).join("");
}

/**
 * Source provenance is already available through the source pill and inline
 * citations. Remove model-authored appendices so the answer does not repeat
 * the same links a third time below the prose.
 */
export function stripTrailingSourcesSection(markdown: string): string {
  if (!markdown || typeof markdown !== "string") return markdown;
  const lines = markdown.split(/\r?\n/);
  let insideFence = false;
  let sourceHeading = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) insideFence = !insideFence;
    if (!insideFence && /^\s*(?:#{1,6}\s*)?(?:sources?|references?|works cited)\s*:?\s*$/i.test(line)) {
      sourceHeading = index;
    }
  }

  if (sourceHeading < 0) return markdown;
  const tail = lines.slice(sourceHeading + 1).join("\n").trim();
  if (!tail) return lines.slice(0, sourceHeading).join("\n").trimEnd();

  const looksLikeSourceList = /https?:\/\/|\[[^\]]+\]\([^)]+\)|^\s*[-*\d.]+\s+/m.test(tail)
    || tail.split(/\r?\n/).filter((line) => line.trim()).every((line) => line.trim().length < 180);
  return looksLikeSourceList ? lines.slice(0, sourceHeading).join("\n").trimEnd() : markdown;
}
