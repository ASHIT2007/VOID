import { useState, useEffect } from "react";
import type { PresentationData, Slide } from "../types/presentation";
import { VISUAL_GENERATION_DIRECTIVE } from '../lib/design/generation-prompt';

export type ThinkingEffort = "low" | "medium" | "high";

export function normalizeChatEffort(value: string | null): ThinkingEffort {
  return value === "low" || value === "high" ? value : "medium";
}

/**
 * Detect prompts that refer to an attachment sent in an earlier message. Keep
 * this narrower than a generic pronoun check so an old upload is not silently
 * carried into an unrelated topic.
 */
export function referencesEarlierAttachment(message: string): boolean {
  return /\b(?:this|that|these|those|the|previous|attached|uploaded)\s+(?:image|photo|picture|file|document|pdf|pptx?|powerpoint|presentation|deck|spreadsheet|notes)s?\b/i.test(message)
    || /\b(?:rate|review|evaluate|critique|summarize|analyse|analyze)\s+(?:this|that|these|those|it|the\s+(?:file|document|pdf|pptx?|powerpoint|presentation|deck|notes))\b/i.test(message)
    || /\bwhat(?:'s|\s+is)\s+(?:this|that|it)\b/i.test(message)
    || /\btell\s+me\s+about\s+(?:this|that|it)\b/i.test(message)
    || /\b(?:this|that|the\s+(?:attached|uploaded))\s+(?:car|vehicle|object|item|product|person|animal|building|diagram|chart|screenshot|screen|design|artwork|logo)\b/i.test(message);
}

type ConversationMessage = { role: string; content: string };
/** Resolve an artifact edit before choosing text/image/studio transport. */
export function resolveInfographicFollowUp(messages: ConversationMessage[], request: string): string {
  if (isInfographicCreationRequest(request) || !/\b(?:make|create|add|include|update|change|redo|use)\b/i.test(request)
    || !/\b(?:one|it|this|that|same|pics?|pictures?|photos?|images?)\b/i.test(request)
    || /\b(?:instead|new topic|website|presentation|poster|email)\b/i.test(request)) return request;
  const history = messages.filter((message) => message.role === "user" && message.content !== request);
  const edits: string[] = [];
  for (const message of history.slice(-6).reverse()) {
    const candidate = cleanContext(message.content);
    if (isInfographicCreationRequest(candidate)) {
      return `${candidate}\n\nRequested changes: ${[...edits.reverse(), request].join("; ")}`;
    }
    // Never cross an intervening topic to revive an old infographic.
    if (!/\b(?:one|it|this|that|same)\b/i.test(candidate) || !/\b(?:make|add|include|update|change|redo|use)\b/i.test(candidate)) break;
    edits.push(candidate);
  }
  return request;
}
export type ChatMediaImage = {
  url: string;
  title?: string;
  alt?: string;
  query?: string;
  sourceUrl?: string;
  sourceDomain?: string;
  attribution?: string;
  confidence?: number;
  width?: number;
  height?: number;
  verified?: boolean;
  generated?: boolean;
  modelUsed?: string;
  slideId?: string;
  slideNumber?: number;
};

const creationVerb = /\b(?:create|make|generate|genrate|genarate|generat|build|design|prepare|draft|produce|compose|draw|render|turn .+ into|convert .+ (?:to|into)|export)\b/i;
const posterNoun = /\b(?:posters?|banners?|infographics?|information graphic|flyers?|visual (?:analysis|explainer|summary|overview|breakdown)|at[- ]a[- ]glance)\b/i;
const presentationNoun = /\b(?:presentation|powerpoint|pptx?|slide deck|slides)\b/i;
const rasterPosterNoun = /\b(?:posters?|banners?|flyers?|infographics?|information graphic|visual (?:analysis|explainer|summary|overview|breakdown)|at[- ]a[- ]glance)\b/i;
// Ordinary infographics use the high-fidelity image compositor. Keep the
// editable studio available when the user explicitly asks for an editable,
// native, vector, academic, or research artifact.
const structuredPosterIntent = /\b(?:academic|research|conference|scientific|data[- ]?driven|editable|native|vector|svg|study sheet|visual roadmap|one[- ]page brief)\b/i;

function isCreationRequest(message: string, noun: RegExp): boolean {
  if (!noun.test(message) || /^\s*\/(?:imagine|model)\b/i.test(message)) return false;
  return creationVerb.test(message)
    || /\b(?:i (?:want|need)|can i (?:get|have)|give me)\b/i.test(message)
    || /^\s*(?:a|an)?\s*(?:poster|banner|infographic|information graphic|flyer|visual (?:analysis|explainer|summary|overview|breakdown)|at[- ]a[- ]glance|presentation|powerpoint|pptx?|slide deck)\s+(?:about|on|for|of)\b/i.test(message);
}

export const isInfographicCreationRequest = (message: string): boolean => (
  isCreationRequest(message, /\b(?:infographics?|information graphic|visual (?:analysis|explainer|summary|overview|breakdown)|at[- ]a[- ]glance)\b/i)
  || /\b(?:analy[sz]e|explain|summari[sz]e)\b[^.!?]{0,80}\bvisually\b/i.test(message)
);
export const isPosterCreationRequest = (message: string): boolean => isCreationRequest(message, posterNoun) || isInfographicCreationRequest(message);
export const isPresentationCreationRequest = (message: string): boolean => isCreationRequest(message, presentationNoun);
/**
 * ChatGPT-style poster requests are finished images. Keep information-dense or
 * explicitly editable poster formats in the visual studio where their text and
 * figures remain selectable.
 */
export const isRasterPosterCreationRequest = (message: string): boolean => (
  (isCreationRequest(message, rasterPosterNoun) || isInfographicCreationRequest(message))
  && !presentationNoun.test(message)
  && !structuredPosterIntent.test(message)
);
export const isStudioCreationRequest = (message: string): boolean => (
  isPresentationCreationRequest(message)
  || (isPosterCreationRequest(message) && !isRasterPosterCreationRequest(message))
);

/** Never mount a title-only poster/infographic returned by a weak model. */
export function hasRenderablePosterContent(data: PresentationData): boolean {
  const slide = data?.slides?.[0];
  if (slide?.layout === "raster-poster" && isUsableChatImageUrl(slide.imageUrl)) return true;
  if (!slide || !slide.content || typeof slide.content !== "object") return false;
  const content = slide.content;
  const words = (value?: string) => (value || "").trim().split(/\s+/).filter(Boolean).length;
  const usefulBullets = (content.bullets || []).filter((item) => words(item) >= 4);
  const textSupport = words(content.bodyText) >= 12 || usefulBullets.length >= 2;
  const metrics = [...(content.metrics || []), ...(content.factCards || [])];
  const completeFigure = (content.timeline?.length || 0) >= 3
    || (content.process?.length || 0) >= 3
    || (content.chart?.data?.length || 0) >= 3
    || (content.matrix?.items?.length || 0) >= 4
    || Boolean(content.comparison
      && content.comparison.left?.points?.length >= 2
      && content.comparison.right?.points?.length >= 2);
  if (data.format === "infographic") return textSupport && completeFigure;
  const visualSupport = Boolean(slide.imageUrl || slide.imagePrompt);
  return textSupport && (completeFigure || metrics.length >= 2 || usefulBullets.length >= 2 || visualSupport);
}

export function isNaturalImageGeneration(message: string): boolean {
  if (isRasterPosterCreationRequest(message)) return true;
  if (isStudioCreationRequest(message)) return false;
  const visual = /\b(?:images?|pictures?|photos?|illustrations?|artworks?|wallpapers?|logos?|icons?|portraits?|scenes?)\b/i.test(message);
  const text = /\b(?:response|reply|answer|text|code|list|plan|essay|story|poem|email|message|table|chart|analysis|report|presentation|website|app|explain|explanation|elaborate|describe|description|discuss|details?|write[- ]?up|caption)\b/i.test(message);
  const direct = /^\s*(?:(?:please|can you|could you|would you)\s+)?(?:generate|genrate|genarate|generat|create|draw|render|paint|illustrate)\b/i.test(message);
  return (direct && !text)
    || (visual && /\b(?:generate|genrate|genarate|generat|create|make|design|draw|render|paint|illustrate)\b/i.test(message));
}

/** Add only the prior topic to a referential poster prompt, never artifact JSON. */
export function prepareRasterPosterPrompt<T extends ConversationMessage>(messages: T[], request: string): string {
  const cleanRequest = cleanContext(request);
  if (!isRasterPosterCreationRequest(cleanRequest) || !refersToTopic(cleanRequest)) return cleanRequest;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const candidate = cleanContext(message.content);
    if (!candidate || candidate === cleanRequest || refersToTopic(candidate)) continue;
    return `${cleanRequest}\n\nTopic to depict: ${candidate.slice(0, 900)}`;
  }
  return cleanRequest;
}

function cleanContext(content: string): string {
  return content.split("[META_JSON:")[0].split("[ATTACHMENTS_JSON:")[0]
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/data:image\/[^\s)"']+/gi, "[image]")
    .trim();
}

function refersToTopic(request: string): boolean {
  // A named subject takes precedence over a style reference to a previous design.
  const explicitTopic = /\b(?:about|on|for|of|covering)\s+(?!(?:the\s+)?(?:same|this|that|previous|above|it|these|those)\b)[a-z0-9]/i.test(request);
  if (explicitTopic) return false;
  return /\b(?:(?:same|this|that|previous|above)\s+(?:topic|subject|content|information|theme)|(?:about|on|of)\s+(?:it|this|that)|turn\s+(?:it|this|that)|based on\s+(?:it|this|that)|these (?:facts|findings)|this into|that into)\b/i.test(request);
}

const studioInstructions = (poster: boolean) => [
  "Return the finished editable artifact in one fenced gamma-presentation JSON block.",
  'Use {id,title,format,theme,designPlan,slides:[{id,slideNumber,layout,title,subtitle,visualRole,imagePrompt,imageUrl,imagePosition,content:{bodyText,bullets,sources}}]} with real subject-specific titles and substantive content.',
  poster
    ? 'Use exactly one slide with layout "poster" and format "poster", "infographic", or "academic-poster" as requested. Include a relevant verified image or a precise imagePrompt unless the user explicitly asks for no image. Keep all text editable. Do not return a raster image or a GENERATE_IMAGE marker.'
    : 'Use format "presentation" with the exact requested number of slides. If the user asks for one slide per member, person, product, place, event, or other item, enumerate every item and create a distinct substantive slide for each one; add a cover, synthesis, and references instead of replacing any requested item slide. Reserve the penultimate slide for a real synthesis/conclusion and the final slide for sources/references. Build a deliberate flow: cover, context or requested item slides, synthesis, references. Every ordinary slide needs balanced supporting content; a heading plus one line is incomplete. Select layouts from the actual content: timeline only for chronology, comparison only for two comparable groups, and image layouts only with a slide-specific image. Keep 2–4 concise bullets per content slide, stay below about 85 words total per slide, and keep titles and content editable.',
  'For every image, make imagePrompt name the exact slide subject, time period, and required evidence rather than only the deck topic. Maps, charts, and color-coded diagrams must fit completely inside their frame and include a clear native legend or explanatory visualCaption. Never use a merely adjacent or era-mismatched image.',
  "Honor every slide-specific and element-specific customization in the user's prompt. Preserve source URLs. Only use image URLs actually supplied by media tools; do not invent URLs or facts.",
].join(" ");

/** Resolve follow-ups for transport only; never append historical text to the visible user message. */
export function prepareStudioMessages<T extends ConversationMessage>(messages: T[]): T[] {
  const latest = messages.at(-1);
  if (!latest || latest.role !== "user" || !isStudioCreationRequest(latest.content)) return messages;
  const request = cleanContext(latest.content);
  let context = "";
  if (refersToTopic(request)) {
    let topicStart = -1;
    for (let i = messages.length - 2; i >= 0; i -= 1) {
      if (messages[i].role !== "user" || !cleanContext(messages[i].content)) continue;
      topicStart = i;
      if (!refersToTopic(messages[i].content)) break;
    }
    if (topicStart >= 0) {
      const relevant = messages.slice(topicStart, -1);
      const sourceRequest = relevant.find((message) => message.role === "user");
      const latestAnswer = [...relevant].reverse().find((message) => message.role === "assistant" && cleanContext(message.content));
      context = `\n\nTopic context from the latest relevant conversation turn:\n${cleanContext(sourceRequest?.content || "").slice(0, 4000)}`;
      if (latestAnswer) context += `\nLatest response or editable artifact for this topic:\n${cleanContext(latestAnswer.content).slice(0, 18000)}`;
    }
  }
  return [{ ...latest, content: `${request}${context}\n\nArtifact requirements: ${studioInstructions(isPosterCreationRequest(request))}\n${VISUAL_GENERATION_DIRECTIVE}` }];
}

export function isUsableChatImageUrl(url?: string): boolean {
  return Boolean(url && (/^https?:\/\/[^\s]+$/i.test(url)
    || /^\/api\/generated-image\/[a-z0-9-]+\.(?:png|jpe?g|webp)(?:\?[^\s]*)?$/i.test(url)
    || /^\/generated_posters\/poster_\d+\.(?:svg|png|jpe?g|webp)(?:\?[^\s]*)?$/i.test(url)));
}

export function isUsefulImageSize(width: number, height: number): boolean {
  // Small sourced thumbnails remain useful. Only reject broken images and tracking pixels.
  return Math.min(width, height) >= 96 && width * height >= 18000;
}

export function mergeChatMediaImages(previous: ChatMediaImage[], incoming: ChatMediaImage[]): ChatMediaImage[] {
  const byUrl = new Map(previous.map((image) => [image.url, image]));
  for (const image of incoming) {
    if (!image || !isUsableChatImageUrl(image.url)) continue;
    const defined = Object.fromEntries(Object.entries(image).filter(([, value]) => value !== undefined));
    byUrl.set(image.url, { ...byUrl.get(image.url), ...defined } as ChatMediaImage);
  }
  return [...byUrl.values()];
}

/**
 * Extracts any web images embedded in markdown prose (e.g. ![alt](url) or <img src="url">)
 * so they can be neatly presented together at the top of the answer, and removes them from
 * the markdown text so they don't appear randomly scattered inside paragraphs.
 */
export function extractAndStripWebImages(markdown: string): { cleanContent: string; extractedWebImages: ChatMediaImage[] } {
  if (!markdown || typeof markdown !== "string") {
    return { cleanContent: markdown || "", extractedWebImages: [] };
  }

  const extractedWebImages: ChatMediaImage[] = [];
  const seenUrls = new Set<string>();

  const isExternalWebUrl = (url: string) => {
    if (!url || typeof url !== "string") return false;
    const trimmed = url.trim();
    if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) return false;
    if (trimmed.includes("pollinations.ai") || trimmed.startsWith("data:")) return false;
    return isUsableChatImageUrl(trimmed);
  };

  const getSourceDomain = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return undefined;
    }
  };

  // 1. Markdown image syntax: ![alt](url)
  const mdImgRegex = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = mdImgRegex.exec(markdown)) !== null) {
    const alt = match[1]?.trim() || "";
    const url = match[2]?.trim() || "";
    if (isExternalWebUrl(url) && !seenUrls.has(url)) {
      seenUrls.add(url);
      extractedWebImages.push({
        url,
        alt: alt || undefined,
        title: alt || undefined,
        sourceDomain: getSourceDomain(url),
      });
    }
  }

  // 2. HTML img syntax: <img ... src="url" ...>
  const htmlImgRegex = /<img\s+[^>]*src=["'](https?:\/\/[^"'\s]+)["'][^>]*>/gi;
  while ((match = htmlImgRegex.exec(markdown)) !== null) {
    const url = match[1]?.trim() || "";
    const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
    const alt = altMatch ? altMatch[1].trim() : "";
    if (isExternalWebUrl(url) && !seenUrls.has(url)) {
      seenUrls.add(url);
      extractedWebImages.push({
        url,
        alt: alt || undefined,
        title: alt || undefined,
        sourceDomain: getSourceDomain(url),
      });
    }
  }

  // 3. Clean all web image tags and orphan image markers from markdown prose
  const clean = markdown
    .replace(/!\[[^\]]*\]\(https?:\/\/[^)\s]+\)/gi, "")
    .replace(/<img\s+[^>]*src=["']https?:\/\/[^"'\s]+["'][^>]*\/?>/gi, "")
    .replace(/!\[[^\]]*\]\((?:\s*|undefined|null|\[object\s+Object\])\)/gi, "")
    .replace(/!\[\[object\s+Object\][^\]]*\]/gi, "")
    .replace(/(^|\n)[ \t]*![ \t]*(?=\n|$)/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanContent: clean, extractedWebImages };
}


const MEDIA_STOP_WORDS = new Set(["about", "after", "before", "chapter", "content", "from", "into", "overview", "presentation", "slide", "slides", "story", "their", "these", "this", "through", "with"]);
const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !MEDIA_STOP_WORDS.has(word)));

/** Assign only current-turn media; keep existing URLs and their provenance, including generated assets. */
export function assignPresentationMedia(data: PresentationData, images: ChatMediaImage[]): PresentationData {
  if (data.hideImages) return data;
  const candidates = mergeChatMediaImages([], images).filter((image) => image.verified === true || image.generated === true);
  const used = new Set(data.slides.map((slide) => slide.imageUrl).filter(isUsableChatImageUrl));
  const slides = data.slides.map((slide, index): Slide => {
    const existing = isUsableChatImageUrl(slide.imageUrl) ? slide.imageUrl : undefined;
    const content = slide.content || {};
    const structured = Boolean(content.chart?.data?.length || content.timeline?.length || content.comparison || content.process?.length || content.quote?.text
      || ["timeline", "comparison", "process", "cycle", "diagram", "big-stat", "quote", "closing", "section-header", "references"].includes(slide.layout));
    const deckWords = words(data.title);
    const titleWords = words(`${slide.title} ${slide.subtitle || ""}`);
    const slideWords = words(`${slide.title} ${slide.subtitle || ""} ${slide.imagePrompt || ""} ${content.bodyText || ""} ${(content.bullets || []).join(" ")}`);
    const slideYears = new Set(`${slide.title} ${slide.subtitle || ""} ${content.bodyText || ""}`.match(/\b(?:18|19|20)\d{2}\b/g) || []);
    const ranked = candidates.filter((image) => !used.has(image.url)
      && (!image.slideId || image.slideId === slide.id)
      && (!image.slideNumber || image.slideNumber === slide.slideNumber))
      .map((image) => {
        const imageText = `${image.title || ""} ${image.alt || ""} ${image.query || ""} ${image.attribution || ""} ${image.sourceDomain || ""}`;
        const imageWords = words(imageText);
        const explicit = image.slideId === slide.id || image.slideNumber === slide.slideNumber;
        const titleOverlap = [...titleWords].filter((word) => imageWords.has(word)).length;
        const slideOverlap = [...slideWords].filter((word) => imageWords.has(word)).length;
        const deckOverlap = [...deckWords].filter((word) => imageWords.has(word)).length;
        const imageYears = new Set(imageText.match(/\b(?:18|19|20)\d{2}\b/g) || []);
        const temporalConflict = slideYears.size > 0 && imageYears.size > 0 && ![...slideYears].some((year) => imageYears.has(year));
        return { image, explicit, titleOverlap, slideOverlap, deckOverlap, temporalConflict, score: (explicit ? 100 : 0) + titleOverlap * 24 + slideOverlap * 10 + deckOverlap * 2 - (temporalConflict ? 120 : 0) };
      }).sort((a, b) => b.score - a.score);
    const canAcceptImage = data.format !== "presentation" || !structured;
    const top = ranked[0];
    const topIsRelevant = Boolean(top && (
      !top.temporalConflict && (top.explicit
      || top.titleOverlap >= 2
      || (top.titleOverlap >= 1 && top.slideOverlap >= 2)
      || (top.slideOverlap >= 1 && top.deckOverlap >= 1)
      || (index === 0 && top.deckOverlap >= 2))
    ));
    const match = existing ? candidates.find((image) => image.url === existing)
      : canAcceptImage && topIsRelevant ? top.image : undefined;
    const imageUrl = existing || match?.url;
    if (!imageUrl) return slide;
    used.add(imageUrl);
    const source = match?.sourceUrl || (match?.sourceDomain ? `https://${match.sourceDomain.replace(/^https?:\/\//, "")}` : undefined);
    return {
      ...slide,
      imageUrl,
      visualRole: ["hero-image", "documentary-image", "product-image", "annotated-image"].includes(slide.visualRole || "")
        ? slide.visualRole : "documentary-image",
      visualCaption: slide.visualCaption || match?.attribution || match?.sourceDomain,
      content: { ...content, sources: [...new Set([...(content.sources || []), ...(source ? [source] : [])])] },
      // Retain full provenance alongside the editable slide, including generator metadata.
      ...(match ? { imageSource: { ...match } } : {}),
    };
  });
  return { ...data, slides };
}

export function asPoster(data: PresentationData, request: string): PresentationData {
  const first = data.slides[0];
  if (!first) return data;
  const sources = [...new Set(data.slides.flatMap((slide) => slide.content?.sources || []))];
  const bodies = data.slides.map((slide) => slide.content?.bodyText).filter(Boolean);
  return {
    ...data,
    format: /infographic/i.test(request) ? "infographic" : /academic|research|conference/i.test(request) ? "academic-poster" : "poster",
    slides: [{
      ...first,
      title: data.title || first.title,
      layout: "poster",
      content: data.slides.length === 1 ? first.content : {
        ...first.content,
        bodyText: bodies.join("\n\n").slice(0, 1200) || undefined,
        bullets: data.slides.flatMap((slide) => slide.content?.bullets || []).slice(0, 8),
        metrics: data.slides.flatMap((slide) => slide.content?.metrics || []).slice(0, 4),
        factCards: data.slides.flatMap((slide) => slide.content?.factCards || []).slice(0, 4),
        timeline: data.slides.flatMap((slide) => slide.content?.timeline || []).slice(0, 6),
        sources,
      },
    }],
  };
}

export type ChatProgressLog = { action?: string; query?: string };
const internalProgress = /\b(?:agents?|workers?|specialists?|synthesizer|orchestrat\w*|auto|routing|model|provider|tokens?|confidence|effort|fallback)\b/i;

export function visibleProgressLogs(logs: ChatProgressLog[] = []): ChatProgressLog[] {
  const result: ChatProgressLog[] = [];
  for (const log of logs) {
    if (!log || !log.action) continue;
    const internal = internalProgress.test(`${log.action} ${log.query || ""}`);
    const action = internal ? /synthes|writ|finaliz/i.test(log.action) ? "Writing the response"
      : /research|search/i.test(log.action) ? "Researching sources"
      : /verif|fact.?check/i.test(log.action) ? "Checking the details"
      : /repair/i.test(log.action) ? "Refining the artifact"
      : "Reviewing the request" : log.action;
    const item = { action, query: internal ? "" : log.query || "" };
    if (!result.some((entry) => entry.action === item.action && entry.query === item.query)) result.push(item);
  }
  return result;
}

export function visibleThinkingText(content: string | null): string | null {
  return content?.split("\n").filter((line) => !internalProgress.test(line)).join("\n").trim() || null;
}

/**
 * Strips leaked raw "Reasoning Process" or "Thinking Process" blocks from the start
 * of generated responses, isolating the thought steps so they can be shown in the
 * collapsible thinking accordion instead of polluting the visible answer prose.
 */
export function extractMarkdownReasoning(content: string): {
  reasoning: string | null;
  cleaned: string;
} {
  if (!content || typeof content !== "string") {
    return { reasoning: null, cleaned: content || "" };
  }

  // Match header at start: e.g. "Reasoning Process:", "### Reasoning Process", "**Thinking Process:**", etc.
  const headerMatch = content.match(
    /^\s*(?:#{1,4}\s*)?(?:\*{1,2}|_{1,2})?(?:Reasoning(?:\s+Process)?|Thinking(?:\s+Process)?|Thought(?:\s+Process)?|Internal\s+Reasoning)(?:\*{1,2}|_{1,2})?:?\s*\n+/i
  );
  if (!headerMatch) {
    return { reasoning: null, cleaned: content };
  }

  const afterHeaderIndex = headerMatch[0].length;
  const rest = content.slice(afterHeaderIndex);

  // Look for boundary where reasoning ends:
  // 1. Horizontal dividers: --- or *** or ___
  const dividerMatch = rest.match(/\n\s*(?:---|\*\*\*|___)\s*(?:\n+|$)/);
  // 2. Headings that start actual content: e.g. "### Kakashi Hatake: Overview", "## Background"
  const headingMatch = rest.match(/\n\s*#{1,4}\s+(?!(?:Reasoning|Thinking|Thought)\b)[^\n]+/i);
  // 3. Explicit answer markers: e.g. "**Final Answer:**", "Answer:", "Response:"
  const answerMarkerMatch = rest.match(/\n\s*(?:\*{1,2}|_{1,2})?(?:Final Answer|Response|Answer|Overview)(?:\*{1,2}|_{1,2})?:?\s*(?:\n+|$)/i);

  const candidates: { index: number; length: number }[] = [];
  if (dividerMatch && dividerMatch.index !== undefined) {
    candidates.push({ index: dividerMatch.index, length: dividerMatch[0].length });
  }
  if (headingMatch && headingMatch.index !== undefined) {
    // Keep the heading as part of the clean text (only consume the leading newline)
    candidates.push({ index: headingMatch.index, length: 1 });
  }
  if (answerMarkerMatch && answerMarkerMatch.index !== undefined) {
    candidates.push({ index: answerMarkerMatch.index, length: answerMarkerMatch[0].length });
  }

  // 4. If no explicit separator was used, detect transition from list items to regular narrative prose
  if (candidates.length === 0) {
    const proseTransitionMatch = rest.match(/\n\n(?=[A-Z][a-zA-Z0-9"'\s]{8,}(?!\n\s*[-*•\d]))/);
    if (proseTransitionMatch && proseTransitionMatch.index !== undefined) {
      candidates.push({ index: proseTransitionMatch.index, length: 2 });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.index - b.index);
    const chosen = candidates[0];
    const reasoning = rest.slice(0, chosen.index).trim();
    const cleaned = rest.slice(chosen.index + chosen.length).trim();
    return {
      reasoning: reasoning || null,
      cleaned,
    };
  }

  // If no boundary found yet (e.g. streaming thoughts actively before the answer starts)
  return {
    reasoning: rest.trim() || null,
    cleaned: "",
  };
}

export function extractThinkAndDisplayContent(rawContent: string): {
  thinkContent: string | null;
  displayContent: string;
} {
  if (!rawContent || typeof rawContent !== "string") {
    return { thinkContent: null, displayContent: "" };
  }

  // Helper to remove any <call_search>...</call_search> block from display output and clean citation tags
  const stripSystemTags = (content: string) => {
    let stripped = content.replace(/<call_search>[\s\S]*?<\/call_search>/gi, "");
    stripped = stripped.replace(/<call_search>[^<]*$/i, "");
    stripped = stripped.replace(/【(\d+)(?:[†:][^】]*)?】/g, "[$1]");
    stripped = stripped.replace(/【[^】]*】/g, "");
    return stripped.trim();
  };

  let initialThink: string | null = null;
  let rawDisplay = rawContent;

  const thinkStartIndex = rawContent.indexOf("<think>");
  if (thinkStartIndex !== -1) {
    const lastThinkEndIndex = rawContent.lastIndexOf("</think>");
    if (lastThinkEndIndex !== -1 && lastThinkEndIndex > thinkStartIndex) {
      initialThink = rawContent.slice(thinkStartIndex + 7, lastThinkEndIndex).trim() || null;
      const beforeThink = rawContent.slice(0, thinkStartIndex);
      const afterThink = rawContent.slice(lastThinkEndIndex + 8);
      rawDisplay = (beforeThink + afterThink).trim().replace(/<\/?think>/gi, "").trim();
    } else {
      // Still actively streaming thoughts (no closing </think> yet)
      initialThink = rawContent.slice(thinkStartIndex + 7).trim() || null;
      rawDisplay = rawContent.slice(0, thinkStartIndex).trim();
    }
  } else if (rawContent.includes("</think>")) {
    const lastThinkEndIndex = rawContent.lastIndexOf("</think>");
    initialThink = rawContent.slice(0, lastThinkEndIndex).trim() || null;
    rawDisplay = rawContent.slice(lastThinkEndIndex + 8).replace(/<\/?think>/gi, "").trim();
  }

  let displayContent = stripSystemTags(rawDisplay);

  // Extract any raw markdown reasoning blocks (e.g. "Reasoning Process:\n1. ...")
  const { reasoning, cleaned } = extractMarkdownReasoning(displayContent);
  let finalThinkContent = initialThink;
  if (reasoning) {
    finalThinkContent = finalThinkContent ? `${finalThinkContent}\n\n${reasoning}` : reasoning;
    displayContent = cleaned;
  }

  return {
    thinkContent: finalThinkContent,
    displayContent,
  };
}

/**
 * Auto-closes unclosed markdown code blocks, backticks, and display math
 * so that rendering partial text never causes syntax breaks or page-wide code formatting.
 */
export function completePartialMarkdown(text: string): string {
  if (!text) return "";
  let completed = text;

  // 1. Close unclosed fenced code blocks
  const codeBlockMatches = completed.match(/```/g);
  if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
    completed += "\n```";
  } else {
    // 2. If not in a fenced code block, check unescaped inline code backticks
    const inlineCodeMatches = completed.match(/(?<!\\)`/g);
    if (inlineCodeMatches && inlineCodeMatches.length % 2 !== 0) {
      completed += "`";
    }
  }

  // 3. Close unclosed display math $$
  const displayMathMatches = completed.match(/\$\$/g);
  if (displayMathMatches && displayMathMatches.length % 2 !== 0) {
    completed += "$$";
  }

  return completed;
}

/**
 * Removes formatting noise commonly emitted during streamed Markdown without
 * touching fenced code. In particular, blank lines between every list item
 * create "loose" lists whose nested paragraphs produce oversized gaps.
 */
export function normalizeAnswerMarkdownSpacing(text: string): string {
  if (!text) return text;

  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((section, index) => {
      if (index % 2 === 1) return section;
      return section
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(
          /(^|\n)([ \t]*(?:[-*+] |\d+[.)] ).+)\n[ \t]*\n(?=[ \t]*(?:[-*+] |\d+[.)] ))/gm,
          "$1$2\n",
        );
    })
    .join("")
    .trim();
}

/** Reveals a newly generated response at stable word boundaries. */
export function useSmoothTypewriter(
  targetContent: string,
  isStreaming: boolean,
  revealEnabled = true,
  animatePlayback = isStreaming,
): string {
  const [shouldAnimate] = useState(Boolean(isStreaming || animatePlayback));
  const [displayedLength, setDisplayedLength] = useState(() => {
    return isStreaming || animatePlayback ? 0 : targetContent.length;
  });

  const targetLength = targetContent.length;

  useEffect(() => {
    if (!revealEnabled || !shouldAnimate) return;

    const tick = () => {
      const target = targetContent.length;
      setDisplayedLength((current) => {
        if (current > target) return target;
        if (current >= target) {
          if (!isStreaming) clearInterval(timerId);
          return current;
        }
        // Advance through exactly one non-whitespace token and its following
        // spacing. Markdown stays syntactically repairable without bursty,
        // character-count-based jumps.
        const remainder = targetContent.slice(current);
        const word = remainder.match(/^\s*\S+\s*/)?.[0];
        return Math.min(target, current + (word?.length || 1));
      });
    };

    const timerId = setInterval(tick, 34);

    return () => {
      clearInterval(timerId);
    };
  }, [targetContent, targetLength, isStreaming, revealEnabled, shouldAnimate]);

  if (displayedLength > targetLength) {
    return targetContent;
  }

  if (!revealEnabled && shouldAnimate) return "";

  if (!shouldAnimate || displayedLength >= targetLength) {
    return targetContent;
  }

  return targetContent.slice(0, displayedLength);
}
