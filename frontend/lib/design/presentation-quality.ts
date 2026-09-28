import type { PresentationData } from '@/types/presentation';
import { normalizePresentation } from './visual-design-engine';
import { presentationSummary } from './presentation-summary';

export function sourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    url.hash = '';
    return url.href;
  } catch { return; }
}

/** Inspect model output before normalization can hide incomplete structure. */
export function inspectPresentation(text: string, request = '', evidence?: string[]): {
  data?: PresentationData; issues: string[];
} {
  const issues: string[] = [];
  let data: PresentationData;
  try {
    const json = text.match(/```(?:gamma-presentation|json)\s*([\s\S]*?)```/i)?.[1] || text;
    data = JSON.parse(json.trim());
    if (!data || !Array.isArray(data.slides) || !data.slides.length || data.slides.length > 40) throw new Error();
  } catch { return { issues: ['Return a complete presentation JSON object with 1–40 slides.'] }; }
  const requestedCount = request.match(/\b(\d{1,2})[ -]*(?:slides?|pages?)\b/i)?.[1];
  if (requestedCount && Number(requestedCount) !== data.slides.length) issues.push(`Provide exactly ${requestedCount} slides, including the conclusion and sources.`);
  const allowedSources = evidence === undefined ? undefined : new Set(evidence.map(sourceUrl).filter(Boolean));
  const ids = new Set<string>();
  for (const [index, slide] of data.slides.entries()) {
    if (!slide || typeof slide !== 'object' || typeof slide.title !== 'string' || !slide.title.trim()
      || !slide.content || typeof slide.content !== 'object' || Array.isArray(slide.content)) {
      issues.push(`Slide ${index + 1}: provide a title and structured content object.`);
      continue;
    }
    if (!slide.id || ids.has(slide.id)) slide.id = `slide-${index + 1}`;
    ids.add(slide.id);
    const c = slide.content;
    for (const field of ['subtitle', 'imageUrl', 'imagePrompt', 'speakerNotes'] as const) {
      if (slide[field] !== undefined && typeof slide[field] !== 'string') {
        issues.push(`Slide ${index + 1}: ${field} must be text.`); slide[field] = undefined;
      }
    }
    // Reject malformed nested data rather than letting it crash the renderer.
    for (const key of ['bullets', 'sources'] as const) {
      if (c[key] && (!Array.isArray(c[key]) || c[key]!.some(item => typeof item !== 'string'))) {
        issues.push(`Slide ${index + 1}: ${key} must contain strings.`);
        c[key] = [];
      }
    }
    for (const key of ['metrics', 'factCards', 'timeline', 'process', 'characterCards'] as const) {
      if (c[key] && (!Array.isArray(c[key]) || c[key]!.some(item => !item || typeof item !== 'object'))) {
        issues.push(`Slide ${index + 1}: invalid ${key}.`);
        c[key] = [];
      }
    }
    if (c.bodyText && typeof c.bodyText !== 'string') { issues.push(`Slide ${index + 1}: bodyText must be text.`); c.bodyText = undefined; }
    const validItems = (items: unknown[], fields: string[]) => items.every(item => item && typeof item === 'object'
      && fields.every(field => typeof (item as Record<string, unknown>)[field] === 'string'));
    for (const [items, fields, name] of [
      [c.timeline || [], ['step', 'title', 'description'], 'timeline'],
      [c.process || [], ['title'], 'process'],
      [c.metrics || [], ['label', 'value'], 'metrics'],
      [c.factCards || [], ['label', 'value'], 'factCards'],
    ] as Array<[unknown[], string[], string]>) {
      if (!validItems(items, fields)) issues.push(`Slide ${index + 1}: ${name} has missing or invalid labels.`);
    }
    if (c.matrix && (!Array.isArray(c.matrix.items) || c.matrix.items.some(item => !item || typeof item.label !== 'string' || !Number.isFinite(item.x) || !Number.isFinite(item.y)))) {
      issues.push(`Slide ${index + 1}: matrix requires labeled numeric positions.`); c.matrix = undefined;
    }
    c.sources = [...new Set((c.sources || []).map(sourceUrl).filter((url): url is string => Boolean(url && (!allowedSources || allowedSources.has(url)))))];
    const references = slide.layout === 'references' || /\b(sources?|references?|bibliography)\b/i.test(slide.title);
    if (references) continue;
    const figure = Boolean(c.timeline?.length || c.process?.length || c.metrics?.length || c.factCards?.length || c.chart?.data?.length || c.matrix?.items?.length || c.comparison || c.quote?.text);
    const words = `${c.bodyText || ''} ${(c.bullets || []).join(' ')}`.split(/\s+/).filter(Boolean).length;
    const divider = index === 0 || slide.layout === 'section-header';
    if (!divider && !figure && words < 18) issues.push(`Slide ${index + 1} (${slide.title}): add substantive subject-specific content; do not leave a blank or title-only page.`);
    if (words > 110 || (c.bullets?.length || 0) > 4) issues.push(`Slide ${index + 1}: condense to 30–100 words and at most 4 bullets without truncating sentences.`);
    if (slide.layout === 'timeline' && (c.timeline?.length || 0) < 3) issues.push(`Slide ${index + 1}: timeline requires at least 3 complete events.`);
    if (['process', 'cycle', 'hierarchy', 'diagram'].includes(slide.layout) && (c.process?.length || 0) < 3) issues.push(`Slide ${index + 1}: provide at least 3 process steps or use an editorial layout.`);
    if (slide.layout === 'comparison' && (!c.comparison?.left?.points?.length || !c.comparison?.right?.points?.length)) {
      issues.push(`Slide ${index + 1}: comparison requires two populated columns.`); c.comparison = undefined;
    }
    if (c.chart && (!Array.isArray(c.chart.data) || c.chart.data.some(point => !point || !Number.isFinite(point.value)))) {
      issues.push(`Slide ${index + 1}: charts require verified numeric data.`); c.chart = undefined;
    }
  }
  if (issues.length) return { issues };
  return { data: normalizePresentation(data), issues };
}

export function presentationBlock(data: PresentationData): string {
  return `${presentationSummary(data)}\n\n\`\`\`gamma-presentation\n${JSON.stringify(data)}\n\`\`\``;
}
