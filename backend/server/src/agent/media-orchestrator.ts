import crypto from 'crypto';
import { evaluateMediaRelevance, deriveMediaSubject, isMediaClassifierFailure } from './semantic-media.js';
export { evaluateMediaRelevance, deriveMediaSubject, parseSemanticMediaDecision, type SemanticMediaDecision } from './semantic-media.js';
import { isDiagramRequest, workspaceInspectionTools } from '@void/shared/chat-intent.mjs';
import { z } from 'zod';
import { runAgentLoop, type AgentEvent, type AgentLoopOptions } from './agent-loop.js';
import { getTool, type ToolImage } from './tool-registry.js';
import { MEDIA_SEARCH_MS } from './media-budget.js';
import { userSearchCredentials } from '../ai/search-credentials.js';

export type MediaIntentCategory = 'explicit' | 'place' | 'product' | 'person_or_subject' | 'animal_or_plant' | 'food' | 'historical' | 'instructional' | 'topic' | 'current_event' | 'artifact' | 'none';

export interface MediaIntentDecision {
  show_images: boolean;
  visual_intent: 'explicit' | 'implicit' | 'none';
  image_query: string | null;
  image_count: number;
  placement: 'top' | 'inline' | 'after_intro' | 'none';
  reason: string;
  considered: boolean;
  category: MediaIntentCategory;
  renderPlacement: 'lead' | 'inline';
  blockedReason?: string;
}

function cleanContextMessage(value: string): string {
  return value
    .split('[META_JSON:')[0]
    .split('[ATTACHMENTS_JSON:')[0]
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveContextualMediaMessage(message: string, _mediaContext = ''): string {
  return cleanContextMessage(message);
}

/** No synchronous keyword classifier may authorize a search. */
export function classifyMediaIntent(_message: string): MediaIntentDecision {
  return { show_images: false, visual_intent: 'none', image_query: null, image_count: 0,
    placement: 'none', reason: 'A semantic relevance decision is required.', considered: false,
    category: 'none', renderPlacement: 'inline' };
}

const mediaPlanSchema = z.object({
  decision: z.enum(['search', 'omit']),
  reason: z.string().min(1).max(500),
  subject: z.string().min(1).max(120),
  queries: z.array(z.string().min(3).max(100)).max(5),
  altText: z.string().min(3).max(240),
  placement: z.enum(['lead', 'inline']),
  safetyCategory: z.enum(['none', 'graphic', 'sensitive_person', 'sports_or_media_still', 'artwork_reproduction']),
}).superRefine((plan, context) => {
  if (plan.decision === 'search' && plan.queries.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['queries'], message: 'Search plans require at least one query.' });
  }
});

const mediaRelevanceDecisionSchema = z.object({
  decision: z.enum(['search', 'omit']),
  reason: z.string().min(1).max(500),
  subject: z.string().min(1).max(120).optional(),
});

export type MediaPlan = z.infer<typeof mediaPlanSchema>;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(candidate);
}

export function parseMediaPlan(text: string): MediaPlan | null {
  try {
    const parsed = mediaPlanSchema.safeParse(extractJson(text.trim()));
    if (!parsed.success) return null;
    if (parsed.data.decision === 'omit') return { ...parsed.data, queries: [] };
    const queries = parsed.data.queries
      .map((query) => query.replace(/\s+/g, ' ').trim())
      .filter((query) => {
        const words = query.split(/\s+/).length;
        return words >= 3 && words <= 8;
      });
    return queries.length > 0 ? { ...parsed.data, queries } : null;
  } catch {
    return null;
  }
}

const BLOCKED_SOURCE = /(?:gettyimages|shutterstock|alamy|dreamstime|depositphotos|youtube|tiktok|instagram|facebook|artstation|deviantart|dailyanimeart|slideshare|teacherspayteachers)/i;
const BLOCKED_METADATA = /\b(?:paparazzi|celebrity gossip|fan art|graphic injury|gore|corpse|autopsy|nsfw|nude)\b/i;
const LOW_QUALITY_DISCOVERY_MEDIA = /\b(?:wallpapers?|wallpaper cave|printables?|coloring pages?|drawing step by step|free (?:image|photo|download)|word templates?|stock vector|reddit)\b/i;
const TRUSTED_SOURCE = /(?:\.gov|\.edu|\.ac\.|wikipedia\.org|wikimedia\.org|britannica\.com|nasa\.gov|who\.int|nationalgeographic\.com|fandom\.com|wikia\.nocookie\.net|cbrimages\.com)/i;
const GENERIC_RELEVANCE_WORDS = new Set([
  'about', 'advantages', 'answer', 'clear', 'context', 'detail', 'explain', 'full', 'image', 'images',
  'guide', 'introduction', 'learn', 'meaning', 'overview', 'photo', 'picture', 'process', 'reference',
  'add', 'also', 'give', 'include', 'its', 'provide', 'show', 'tell', 'too', 'view', 'visual', 'what',
  'who', 'with', 'works',
]);
// A manufacturer alone cannot identify a requested product model. Keep the
// partial-name resilience for e.g. Einstein, but never substitute an Aventador
// for a Terzo Millennio just because both carry the Lamborghini badge.
const SHARED_BRAND_WORDS = new Set(['lamborghini', 'ferrari', 'porsche', 'bugatti', 'mclaren', 'mercedes', 'toyota', 'samsung', 'apple', 'nvidia', 'google', 'microsoft', 'lenovo']);

function words(value: string): Set<string> {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* keep malformed URLs as text */ }
  return new Set(decoded.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !GENERIC_RELEVANCE_WORDS.has(word)));
}

function boundedEditDistance(left: string, right: string, limit: number): number {
  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      rowMinimum = Math.min(rowMinimum, current[rightIndex]);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

function fuzzyWordMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const longest = Math.max(left.length, right.length);
  const shortest = Math.min(left.length, right.length);
  if (shortest < 5 || Math.abs(left.length - right.length) > 2) return false;
  // Short names retain the old one-edit rule. A same-initial name of 7-8
  // characters gets a small extra typo budget so common phonetic misspellings
  // such as "enstine" can match authoritative "Einstein" metadata.
  const limit = longest <= 6 ? 1 : longest <= 8 && left[0] === right[0] ? 3 : 2;
  return boundedEditDistance(left, right, limit) <= limit;
}

function countRelevantWordMatches(queryWords: Set<string>, metadataWords: Set<string>): number {
  return [...queryWords].filter((queryWord) => (
    [...metadataWords].some((metadataWord) => fuzzyWordMatch(queryWord, metadataWord))
  )).length;
}

function canonicalImageFingerprint(candidate: ToolImage): string {
  const raw = candidate.url.trim();
  try {
    const parsed = new URL(raw);
    parsed.search = '';
    parsed.hash = '';
    let path = parsed.pathname.replace(/\/thumb\//i, '/');
    // Wikimedia thumbnail URLs append a rendered-size copy of the original
    // filename. Remove that suffix so different thumbnail sizes collapse to
    // the same underlying image.
    path = path.replace(/\/\d+px-[^/]+$/i, '');
    return `${parsed.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return raw.toLowerCase().split(/[?#]/)[0];
  }
}

function canonicalMetadataFingerprint(candidate: ToolImage): string {
  const rawTitle = candidate.title || '';
  const specificTitle = rawTitle.includes('—') ? rawTitle.split('—').slice(1).join(' ') : rawTitle;
  const title = [...words(specificTitle)].sort().join('-');
  let source = (candidate.sourceUrl || '').toLowerCase().split(/[?#]/)[0];
  try {
    const parsed = new URL(candidate.sourceUrl || '');
    source = `${parsed.hostname.toLowerCase()}${parsed.pathname.toLowerCase()}`;
  } catch {}
  return title && source ? `${source}|${title}` : '';
}

export function isStrongMetadataMediaMatch(candidate: ToolImage, plan: MediaPlan, allowDistinctivePartialMatch = false): boolean {
  if (!candidate.verified || !/^https?:\/\//i.test(candidate.url)) return false;
  const subjectWords = words(plan.subject);
  if (subjectWords.size === 0) return false;

  // Wikipedia file candidates are titled "Article — file name". Only the file
  // name is evidence about the actual pixels; the article prefix merely says
  // where the image was discovered and caused homonyms to rank as exact hits.
  const rawTitle = candidate.title || '';
  const specificTitle = rawTitle.includes('—') ? rawTitle.split('—').slice(1).join(' ') : rawTitle;
  const specificWords = words(`${specificTitle} ${candidate.url}`);
  const specificMatches = countRelevantWordMatches(subjectWords, specificWords);
  const hasDistinctivePartialMatch = allowDistinctivePartialMatch
    && specificMatches >= 1
    && [...subjectWords].some((subjectWord) => subjectWord.length >= 6 && !SHARED_BRAND_WORDS.has(subjectWord)
      && [...specificWords].some((metadataWord) => fuzzyWordMatch(subjectWord, metadataWord)));
  const requiredMatches = hasDistinctivePartialMatch ? 1 : Math.min(2, subjectWords.size);
  if (specificMatches < requiredMatches) return false;

  const sourceText = `${candidate.sourceDomain || ''} ${candidate.sourceUrl || ''}`;
  const authority = TRUSTED_SOURCE.test(sourceText) || Boolean(candidate.sourceUrl);
  return authority && (candidate.confidence || 0) >= 0.62;
}

export function filterAndRankMediaCandidates(candidates: ToolImage[], plan: MediaPlan, originalMessage: string): ToolImage[] {
  if (plan.safetyCategory !== 'none') return [];
  const queryWords = words(plan.subject);
  const explicitVisualRequest = /\b(?:cosplay|fan art)\b/i.test(originalMessage);
  const seenUrls = new Set<string>();

  const ranked = candidates
    .filter((candidate) => {
      const metadata = `${candidate.url} ${candidate.title || ''} ${candidate.sourceUrl || ''} ${candidate.sourceDomain || ''} ${candidate.attribution || ''}`;
      const accepted = /^https?:\/\//i.test(candidate.url)
        && candidate.verified === true
        && !seenUrls.has(candidate.url)
        && !BLOCKED_SOURCE.test(metadata)
        && !BLOCKED_METADATA.test(metadata)
        && (!LOW_QUALITY_DISCOVERY_MEDIA.test(metadata) || LOW_QUALITY_DISCOVERY_MEDIA.test(originalMessage))
        && !(/\b(?:cosplay|cosplayer|costume|figurine|merchandise)\b/i.test(metadata)
          && !/\b(?:cosplay|cosplayer|costume|figurine|merchandise)\b/i.test(originalMessage))
        && !(/\b(?:world war|historical|history|battle)\b/i.test(originalMessage)
          && /(?:amazon|ebay|etsy|book cover|novel cover|merchandise)/i.test(metadata));
      if (accepted) seenUrls.add(candidate.url);
      return accepted;
    })
    .map((candidate) => {
      const metadataWords = words(`${candidate.title || ''} ${candidate.url} ${candidate.sourceUrl || ''} ${candidate.sourceDomain || ''} ${candidate.attribution || ''}`);
      const overlap = countRelevantWordMatches(queryWords, metadataWords);
      const relevance = queryWords.size > 0 ? Math.min(overlap / Math.min(queryWords.size, 6), 1) : 0;
      const sourceText = `${candidate.sourceDomain || ''} ${candidate.sourceUrl || ''}`;
      const authority = TRUSTED_SOURCE.test(sourceText) ? 0.2 : candidate.sourceUrl ? 0.08 : 0;
      const resolution = (candidate.width || 0) >= 800 && (candidate.height || 0) >= 500 ? 0.15
        : (candidate.width || 0) >= 400 && (candidate.height || 0) >= 250 ? 0.08 : 0;
      const upstream = Math.min(Math.max(candidate.score || 0, 0), 1) * 0.12;
      const canonicalSubject = [...queryWords].join(' ');
      const canonicalTitle = [...words(candidate.title || '')].join(' ');
      const directSubjectImage = canonicalTitle === canonicalSubject && /wikipedia\.org/.test(sourceText) ? 0.12 : 0;
      const confidence = Math.min(0.98, 0.12 + relevance * 0.4 + authority + resolution + upstream + directSubjectImage);
      const distinctivePartialMatch = explicitVisualRequest
        && overlap >= 1
        && [...queryWords].some((queryWord) => queryWord.length >= 6 && !SHARED_BRAND_WORDS.has(queryWord)
          && [...metadataWords].some((metadataWord) => fuzzyWordMatch(queryWord, metadataWord)));
      return {
        ...candidate,
        alt: plan.altText,
        query: candidate.query || plan.queries[0],
        attribution: candidate.attribution || candidate.sourceDomain || 'Source website',
        confidence: overlap === 0 || (queryWords.size > 1 && overlap < Math.min(2, queryWords.size) && !distinctivePartialMatch) ? 0 : confidence,
        verified: true,
      };
    })
    .filter((candidate) => (candidate.confidence || 0) >= 0.42)
    .sort((left, right) => (right.confidence || 0) - (left.confidence || 0));

  const selected: ToolImage[] = [];
  const selectedUrls = new Set<string>();
  const selectedDomains = new Set<string>();
  const selectedImageFingerprints = new Set<string>();
  const selectedMetadataFingerprints = new Set<string>();
  const take = (candidate: ToolImage | undefined, allowRepeatedDomain = false) => {
    if (!candidate || selectedUrls.has(candidate.url)) return;
    const domain = candidate.sourceDomain || '';
    if (!allowRepeatedDomain && domain && selectedDomains.has(domain)) return;
    const imageFingerprint = canonicalImageFingerprint(candidate);
    const metadataFingerprint = canonicalMetadataFingerprint(candidate);
    if (selectedImageFingerprints.has(imageFingerprint) || (metadataFingerprint && selectedMetadataFingerprints.has(metadataFingerprint))) return;
    selected.push(candidate);
    selectedUrls.add(candidate.url);
    selectedImageFingerprints.add(imageFingerprint);
    if (metadataFingerprint) selectedMetadataFingerprints.add(metadataFingerprint);
    if (domain) selectedDomains.add(domain);
  };

  // Prefer one verified result from each deliberately different query before
  // filling any remaining collage slot by confidence.
  for (const query of plan.queries) {
    take(ranked.find((candidate) => candidate.query?.toLowerCase() === query.toLowerCase()
      && !selectedUrls.has(candidate.url)));
  }
  for (const candidate of ranked) {
    if (selected.length >= 12) break;
    take(candidate);
  }
  // If authoritative coverage comes from one archive, allow repeated domains
  // only after diversity has been attempted.
  for (const candidate of ranked) {
    if (selected.length >= 12) break;
    take(candidate, true);
  }
  return selected.slice(0, 12);
}

export function buildDiverseMediaQueries(plan: MediaPlan, _category: MediaIntentCategory): string[] {
  return plan.decision === 'omit' ? [] : [...new Set([plan.subject, ...plan.queries])].slice(0, 3);
}

export function mergePixelReviewedMediaCandidates(
  qualityRanked: ToolImage[],
  reviewShortlist: ToolImage[],
  visuallyVerified: ToolImage[] | null,
  plan: MediaPlan,
  allowDistinctivePartialMatch: boolean,
): ToolImage[] {
  const visuallyAccepted = visuallyVerified || [];
  const acceptedUrls = new Set(visuallyAccepted.map((candidate) => candidate.url));
  const reviewedUrls = new Set(reviewShortlist.map((candidate) => candidate.url));
  const resilientMatches = qualityRanked.filter((candidate) =>
    !acceptedUrls.has(candidate.url)
    // A completed pixel review is authoritative for every candidate it saw.
    // Only an unavailable review, or a strong metadata match that was not in
    // the bounded shortlist, may use the resilient metadata fallback.
    && (visuallyVerified === null || !reviewedUrls.has(candidate.url))
    && isStrongMetadataMediaMatch(candidate, plan, allowDistinctivePartialMatch));
  return [...visuallyAccepted, ...resilientMatches];
}

const mediaVisualReviewSchema = z.object({
  ratings: z.array(z.object({
    index: z.number().int().nonnegative(),
    score: z.number().min(0).max(100),
  })).min(1).max(5),
});

async function verifyMediaCandidatesVisually(
  options: AgentLoopOptions,
  candidates: ToolImage[],
  plan: MediaPlan,
): Promise<ToolImage[] | null> {
  const shortlist = candidates.slice(0, 5);
  if (shortlist.length === 0) return [];

  let text = '';
  let failed = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('Visual relevance review timed out'), 12_000);
  try {
    await runAgentLoop({
      ...options,
      sessionId: `media-review-${crypto.randomUUID()}`,
      message: `Subject that the images must visibly depict: ${plan.subject}\n\nCandidate metadata, in attachment order:\n${shortlist.map((candidate, index) => `${index}: ${candidate.title || 'Untitled'} (${candidate.sourceDomain || 'unknown source'})`).join('\n')}`,
      mode: 'normal',
      reasoningEffort: 'low',
      searchMode: 'off',
      attachments: shortlist.map((candidate, index) => ({
        name: `candidate-${index + 1}`,
        type: candidate.mimeType || 'image/jpeg',
        url: candidate.url,
      })),
      allowedTools: [],
      maxIterations: 1,
      maxProviderAttempts: 1,
      maxOutputTokens: 400,
      signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
      systemContext: `You rate web-image relevance from the visible pixels, not from titles or URLs. Score every attached candidate from 0 to 100 for how clearly it depicts the requested subject and how useful it is for explaining that subject. Decorative hero art, generic portraits, loosely related stock imagery, screenshots of unrelated pages, and mislabeled images score low. For technical topics, prefer legible diagrams, schematics, or clearly identifiable hardware. Return only JSON: {"ratings":[{"index":0,"score":92}]}. Use zero-based attachment indices, include every attachment exactly once, and order ratings from highest to lowest.`,
      onEvent: (event) => {
        if (event.type === 'text_delta') text += event.content;
        else if (event.type === 'response_reset') text = '';
        else if (event.type === 'error') failed = true;
      },
    });
  } catch {
    failed = true;
  } finally {
    clearTimeout(timer);
  }

  if (failed || !text.trim()) return null;
  try {
    const review = mediaVisualReviewSchema.parse(extractJson(text));
    const ratingByIndex = new Map(review.ratings
      .filter((rating) => rating.index < shortlist.length)
      .map((rating) => [rating.index, rating.score]));
    if (ratingByIndex.size !== shortlist.length) return null;
    return shortlist
      .map((candidate, index) => ({
        ...candidate,
        confidence: Math.min(0.99, Math.max(0, (candidate.confidence || 0) * 0.55 + (ratingByIndex.get(index) || 0) / 100 * 0.45)),
      }))
      .filter((_candidate, index) => (ratingByIndex.get(index) || 0) >= 65)
      .sort((left, right) => (right.confidence || 0) - (left.confidence || 0));
  } catch {
    return null;
  }
}

export async function runMediaWorker(options: AgentLoopOptions & { responseText?: string }, onEvent: (event: AgentEvent) => void): Promise<ToolImage[]> {
  const omit = (reason: string) => {
    onEvent({ type: 'media_status', status: 'omitted', label: 'Web images omitted', reason });
    return [] as ToolImage[];
  };
  if (options.isVoice) return omit('Voice responses do not use web images.');
  const message = cleanContextMessage(options.message || '');
  const responseText = options.responseText || '';
  if (!responseText.trim()) return omit('A completed answer is required before selecting images.');
  onEvent({ type: 'media_status', status: 'planning', label: 'Checking whether reference images help' });
  const semantic = await evaluateMediaRelevance(options, responseText);
  const subject = deriveMediaSubject(message, semantic);
  if (isMediaClassifierFailure(semantic)) {
    onEvent({ type: 'media_status', status: 'failed', label: 'Image relevance check failed', reason: semantic.reason });
    return [];
  }
  if (!semantic.should_search || !subject) return omit(semantic.reason);
  const decision: MediaIntentDecision = {
    show_images: true, visual_intent: semantic.category === 'explicit_request' ? 'explicit' : 'implicit',
    image_query: subject, image_count: 3, placement: 'top', reason: semantic.reason,
    considered: true, category: semantic.category === 'explicit_request' ? 'explicit' : 'person_or_subject', renderPlacement: 'lead',
  };
  const plan: MediaPlan = { decision: 'search', subject, reason: semantic.reason,
    queries: [subject], altText: `Reference image of ${subject}`, placement: 'lead', safetyCategory: 'none' };
  options.signal?.throwIfAborted();

  const credentials = userSearchCredentials();
  const imageSearch = credentials.some(item => item.providerId === 'brave') || !credentials.some(item => item.providerId === 'tavily')
    ? getTool('image_search')
    : getTool('web_search');
  if (!imageSearch) {
    onEvent({ type: 'media_status', status: 'failed', label: 'Web image search unavailable' });
    return [];
  }

  onEvent({ type: 'media_status', status: 'searching', label: `Searching images for ${plan.subject}` });
  const imageLimit = 3;
  const searchQueries = [plan.subject];
  const searchPlan = plan;
  const searchTools = [...new Map(
    [imageSearch, getTool('image_search')]
      .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))
      .map((tool) => [tool.name, tool]),
  ).values()];
  const results = await Promise.all(searchTools.flatMap((tool) => searchQueries.map(async (query) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        tool.handler(tool.name === 'web_search'
          ? { query, maxResults: 6, searchDepth: 'basic', includeImages: true }
          : { query, maxResults: 6 }),
        new Promise<import('./tool-registry.js').ToolResult>((resolve) => {
          timer = setTimeout(() => resolve({ content: 'Image search timed out.', error: 'timeout' }), MEDIA_SEARCH_MS);
        }),
      ]);
    } catch { return { content: 'Image search unavailable.', error: 'search_unavailable' }; }
    finally { if (timer) clearTimeout(timer); }
  })));
  options.signal?.throwIfAborted();
  const candidates = results.flatMap((result) => result.images || []);
  onEvent({ type: 'media_status', status: 'verifying', label: 'Verifying image relevance, framing, and provenance' });
  const ranked = filterAndRankMediaCandidates(candidates, searchPlan, message);
  const allowDistinctivePartialMatch = decision.visual_intent === 'explicit';
  const metadataMatches = ranked.filter((candidate) => isStrongMetadataMediaMatch(candidate, searchPlan, allowDistinctivePartialMatch));
  // Identification images should favor encyclopedic, official, institutional,
  // and first-party archives. Keep other exact matches as fallbacks, but never
  // let a wallpaper/template result outrank a usable Wikimedia or Fandom file.
  const trustedMatches = metadataMatches.filter((candidate) => TRUSTED_SOURCE.test(
    `${candidate.sourceDomain || ''} ${candidate.sourceUrl || ''} ${candidate.url}`,
  ));
  const qualityRanked = [
    ...trustedMatches,
    ...ranked.filter((candidate) => !trustedMatches.some((trusted) => trusted.url === candidate.url)),
  ];
  let selected = qualityRanked.filter((candidate) => isStrongMetadataMediaMatch(candidate, searchPlan, allowDistinctivePartialMatch)).slice(0, imageLimit);
  // Strong, subject-specific source metadata is sufficient for ordinary
  // reference images. Reserve scarce vision capacity for ambiguous candidates.
  const requiresPixelReview = selected.length === 0;
  if (qualityRanked.length > 0 && requiresPixelReview) {
    // Review more candidates than the final slot count. If the highest-ranked
    // metadata hit is a homonym (for example Naruto whirlpools), a lower-ranked
    // image that actually depicts the character can still win.
    const reviewShortlist = qualityRanked.slice(0, 5);
    const visuallyVerified = await verifyMediaCandidatesVisually(options, reviewShortlist, searchPlan);
    // Pixel review remains preferred. If the vision route cannot load a remote
    // URL or returns no decision, exact subject-bearing metadata from an
    // attributable source keeps required imagery working without reviving
    // single-word homonyms.
    selected = mergePixelReviewedMediaCandidates(
      qualityRanked,
      reviewShortlist,
      visuallyVerified,
      searchPlan,
      allowDistinctivePartialMatch,
    ).slice(0, imageLimit);
  }
  if (selected.length < 1) {
    const reason = results.some((result) => result.error)
      ? 'Image search failed or timed out; the text response is unaffected.'
      : 'No candidate passed relevance, framing, provenance, and safety checks.';
    onEvent({ type: 'media_status', status: 'omitted', label: 'Continuing without web images', reason });
    return [];
  }

  options.signal?.throwIfAborted();
  selected = groundMediaInAnswer(selected, plan, responseText);
  if (!selected.length) return omit('The selected images do not match the completed answer.');
  onEvent({ type: 'media', query: plan.subject, placement: searchPlan.placement, images: selected });
  onEvent({ type: 'media_status', status: 'completed', label: `${selected.length} relevant web image${selected.length === 1 ? '' : 's'} selected` });
  return selected;
}

export function parseMediaRelevanceDecision(text: string): { decision: 'search' | 'omit'; reason: string; subject?: string } | null {
  try {
    const parsed = mediaRelevanceDecisionSchema.safeParse(extractJson(text.trim()));
    if (parsed.success) return parsed.data;
  } catch {}
  return null;
}

/** Both the entity and subject-specific image metadata must be grounded. */
export function groundMediaInAnswer(images: ToolImage[], plan: MediaPlan, answer: string): ToolImage[] {
  const tokenize = (value: string) => new Set(value.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(word => word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word));
  const nouns = [...tokenize(plan.subject)];
  const responseWords = tokenize(answer);
  if (!nouns.length || !nouns.every(word => responseWords.has(word))) return [];
  return images.filter(image => isStrongMetadataMediaMatch(image, plan, false));
}
