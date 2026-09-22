import crypto from "crypto";

export interface LayoutMetric { label: string; value: string; icon?: string }
export interface LayoutTimelineItem { step: string; title: string; description?: string }
export interface LayoutChartPoint { label: string; value: number }
export interface LayoutChart { type: "bar" | "line"; title?: string; unit?: string; data: LayoutChartPoint[] }
export interface LayoutSection {
  id: string;
  title: string;
  type: "overview" | "findings" | "methods" | "timeline" | "comparison" | "metrics" | "chart" | "conclusion" | "references";
  bodyText?: string;
  bullets?: string[];
  metrics?: LayoutMetric[];
  timeline?: LayoutTimelineItem[];
  chart?: LayoutChart;
}

// Legacy cards remain readable so saved layouts and callers do not break.
export interface LayoutCard extends LayoutSection {
  x_pct?: number;
  y_pct?: number;
  width_pct?: number;
  height_pct?: number;
  bg_color?: string;
  text_color?: string;
  border_color?: string;
}

export interface PosterLayoutJSON {
  title: string;
  subtitle?: string;
  authors?: string;
  institution?: string;
  format: "poster" | "academic-poster" | "infographic" | "flyer";
  style: "editorial" | "scientific" | "historical" | "cinematic" | "minimal" | "playful" | "data-focused" | "bold-typography" | "research-poster";
  composition: "editorial-asymmetric" | "research-figure" | "timeline-story" | "central-object" | "bold-type";
  palette: { background: string; surface: string; text: string; muted: string; primary: string; secondary: string; accent: string };
  imagePrompt?: string;
  visualRole?: "none" | "hero-image" | "documentary-image" | "diagram" | "chart" | "timeline" | "typography";
  keyMessage?: string;
  sections: LayoutSection[];
  sources?: string[];
  mediaSubjects?: string[];
  cards?: LayoutCard[];
  theme?: string;
  bg_gradient?: { start: string; end: string };
  header_bg?: string;
  header_text?: string;
}

interface ProviderState {
  key: string;
  name: string;
  url: string;
  getApiKey: () => string | undefined;
  model: string;
  cooldownUntil: number;
}

const providerPool: ProviderState[] = [
  { key: "nvidia", name: "NVIDIA NIM Cloud", url: "https://integrate.api.nvidia.com/v1/chat/completions", getApiKey: () => process.env.NVIDIA_API_KEY, model: "meta/llama-3.1-70b-instruct", cooldownUntil: 0 },
  { key: "freellm", name: "FreeLLM API", url: process.env.FREELLM_API_URL || "http://127.0.0.1:3001/v1/chat/completions", getApiKey: () => process.env.FREELLM_API_KEY, model: "openai/gpt-oss-120b", cooldownUntil: 0 },
  { key: "groq", name: "Groq High-Speed API", url: "https://api.groq.com/openai/v1/chat/completions", getApiKey: () => process.env.GROQ_API_KEY, model: "llama-3.3-70b-versatile", cooldownUntil: 0 },
];

export function markProviderCooldown(provider: ProviderState, cooldownSeconds = 60) {
  provider.cooldownUntil = Date.now() + cooldownSeconds * 1000;
}

const layoutCache = new Map<string, PosterLayoutJSON>();

function getCacheKey(topic: string, rawText?: string): string {
  return crypto.createHash("sha256").update(`${topic.trim().toLowerCase()}_${(rawText || "").trim().slice(0, 1200).toLowerCase()}`).digest("hex");
}

const POSTER_SYSTEM_PROMPT = `You are a senior graphic designer and information designer. Return only valid JSON for a single professionally art-directed poster.
Schema: {"title":string,"subtitle"?:string,"authors"?:string,"institution"?:string,"format":"poster"|"academic-poster"|"infographic"|"flyer","style":"editorial"|"scientific"|"historical"|"cinematic"|"minimal"|"playful"|"data-focused"|"bold-typography"|"research-poster","composition":"editorial-asymmetric"|"research-figure"|"timeline-story"|"central-object"|"bold-type","palette":{"background":hex,"surface":hex,"text":hex,"muted":hex,"primary":hex,"secondary":hex,"accent":hex},"imagePrompt"?:string,"visualRole":"none"|"hero-image"|"documentary-image"|"diagram"|"chart"|"timeline"|"typography","keyMessage"?:string,"sections":[{"id":string,"title":string,"type":"overview"|"findings"|"methods"|"timeline"|"comparison"|"metrics"|"chart"|"conclusion"|"references","bodyText"?:string,"bullets"?:string[],"metrics"?: [{"label":string,"value":string}],"timeline"?: [{"step":string,"title":string,"description"?:string}],"chart"?: {"type":"bar"|"line","title"?:string,"unit"?:string,"data":[{"label":string,"value":number}]}}],"sources"?:string[]}.
Choose the composition from the information. Use a timeline for dates, metrics only for supplied values, and research-figure only for academic content. Establish a strong title, one central visual idea, clear reading order, restrained palette, readable type, and generous spacing. Avoid dashboards, pills, tiny labels, blue-purple gradients, fake interface elements, generic stock imagery, and repeated containers. Never invent metrics, facts, quotes, citations, or sources. If source material is sparse, use established high-level knowledge and avoid volatile or numerical claims. Never invent or guess acronym expansions, organizations, URLs, email addresses, social handles, sponsors, eligibility rules, dates, statistics, or contact details. Every image prompt must name the exact subject and evidence needed; omit it when no relevant image is justified. For an infographic, return 6 or 7 concise, information-bearing sections and choose the infographic format. For other formats, keep at most 5 concise sections. Reduce prose instead of shrinking text.`;

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\s+/g, " ").trim() : "";
}

const sectionTypes = new Set<LayoutSection["type"]>(["overview", "findings", "methods", "timeline", "comparison", "metrics", "chart", "conclusion", "references"]);

function normalizedSectionType(section: LayoutSection): LayoutSection["type"] {
  if (sectionTypes.has(section.type)) return section.type;
  if (section.timeline?.length) return "timeline";
  if (section.chart?.data?.length) return "chart";
  if (section.metrics?.length) return "metrics";
  return "findings";
}

function campaignSections(topic: string): LayoutSection[] {
  return [
    { id: "focus", title: "The Big Idea", type: "overview", bodyText: `Bring bold ideas for ${topic} into focus through purposeful collaboration and clear execution.` },
    { id: "create", title: "Create Together", type: "findings", bullets: ["Start with a challenge worth solving.", "Build, test, and improve the strongest idea.", "Tell the story with clarity and confidence."] },
    { id: "impact", title: "Make It Matter", type: "conclusion", bodyText: `Turn imagination around ${topic} into a memorable outcome.` },
  ];
}

function applyEvidenceGuard(layout: PosterLayoutJSON, sourceText: string, topic: string): PosterLayoutJSON {
  const contactPattern = /\b(?:contact|website|email|twitter|instagram|linkedin)\b|https?:\/\/|www\.|@[a-z0-9_]+/i;
  const evidenceWords = sourceText
    .replace(/\b(?:please|create|make|generate|genrate|design|render|poster|flyer|banner|strong|clear|hierarchy|concise|messaging|about|for|on|with)\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const sourceIsSparse = evidenceWords.length < 30 && !/\b\d{2,}\b|https?:\/\/|www\./i.test(sourceText);
  if (sourceIsSparse && layout.format !== "infographic") {
    return {
      ...layout,
      title: topic,
      authors: undefined,
      institution: undefined,
      sources: undefined,
      keyMessage: `Imagine boldly. Build thoughtfully. Make ${topic} matter.`,
      sections: campaignSections(topic),
    };
  }
  if (sourceIsSparse) {
    return {
      ...layout,
      authors: undefined,
      institution: undefined,
      sources: undefined,
      sections: layout.sections.map((section) => ({
        ...section,
        metrics: undefined,
        chart: undefined,
      })),
    };
  }
  const sourceProvidesContact = contactPattern.test(sourceText);
  if (sourceProvidesContact) return layout;

  const sections = layout.sections.map((section) => ({
    ...section,
    bodyText: section.bodyText && !contactPattern.test(section.bodyText) ? section.bodyText : undefined,
    bullets: section.bullets?.filter((bullet) => !contactPattern.test(bullet)),
  })).filter((section) => !contactPattern.test(section.title) && (section.bodyText || section.bullets?.length || section.metrics?.length || section.timeline?.length));

  return { ...layout, sections, sources: undefined };
}

function paletteFor(topic: string) {
  const value = topic.toLowerCase();
  if (/history|ancient|archive|war/.test(value)) return { background: "#EDE7DB", surface: "#F8F4EC", text: "#241F1A", muted: "#73695D", primary: "#7A2E25", secondary: "#314A55", accent: "#B78B3A" };
  if (/space|astronomy|cosmos|planet/.test(value)) return { background: "#07090E", surface: "#10141B", text: "#F4F6F8", muted: "#939CA8", primary: "#8EB9E8", secondary: "#B48CC8", accent: "#E8C56B" };
  if (/pokemon|pikachu|children|game|anime/.test(value)) return { background: "#FFF7E8", surface: "#FFFFFF", text: "#1F2940", muted: "#677189", primary: "#E63961", secondary: "#147D92", accent: "#F2B134" };
  if (/biology|medical|science|climate/.test(value)) return { background: "#F4F7F5", surface: "#FFFFFF", text: "#14251F", muted: "#62716B", primary: "#176B57", secondary: "#245C8A", accent: "#D77A2B" };
  return { background: "#F4F1EA", surface: "#FFFDF8", text: "#171717", muted: "#6B6760", primary: "#C34232", secondary: "#1D596B", accent: "#E3A62F" };
}

function normalizeLayout(value: Partial<PosterLayoutJSON> & { cards?: LayoutCard[] }): PosterLayoutJSON | null {
  if (!clean(value.title)) return null;
  const sections = Array.isArray(value.sections) && value.sections.length
    ? value.sections
    : (value.cards || []).map((card, index) => ({
        id: card.id || `section-${index + 1}`,
        title: card.title || `Section ${index + 1}`,
        type: card.type || "findings",
        bodyText: card.bodyText,
        bullets: card.bullets,
        metrics: card.metrics,
        timeline: card.timeline,
      } as LayoutSection));
  return {
    title: clean(value.title),
    subtitle: clean(value.subtitle) || undefined,
    authors: clean(value.authors) || undefined,
    institution: clean(value.institution) || undefined,
    format: value.format || "poster",
    style: value.style || "editorial",
    composition: value.composition || "editorial-asymmetric",
    palette: Object.fromEntries(Object.entries(paletteFor(value.title || "")).map(([key, fallback]) => {
      const color = value.palette?.[key as keyof PosterLayoutJSON['palette']];
      return [key, typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback];
    })) as PosterLayoutJSON['palette'],
    imagePrompt: clean(value.imagePrompt) || undefined,
    visualRole: value.visualRole || (value.imagePrompt ? "hero-image" : "typography"),
    keyMessage: clean(value.keyMessage) || clean(value.subtitle) || undefined,
    sections: sections.slice(0, value.format === "infographic" ? 7 : 5).map((section, index) => ({
      ...section,
      id: section.id || `section-${index + 1}`,
      type: normalizedSectionType(section),
      title: clean(section.title),
      bodyText: clean(section.bodyText) || undefined,
      bullets: section.bullets?.map(clean).filter(Boolean).slice(0, 5),
      metrics: section.metrics?.slice(0, 4),
      timeline: section.timeline?.slice(0, 12),
      chart: section.chart && Array.isArray(section.chart.data) && section.chart.data.length >= 2
        ? {
            type: section.chart.type === "line" ? "line" : "bar",
            title: clean(section.chart.title) || undefined,
            unit: clean(section.chart.unit) || undefined,
            data: section.chart.data
              .filter((point) => clean(point?.label) && Number.isFinite(Number(point?.value)))
              .slice(0, 12)
              .map((point) => ({ label: clean(point.label), value: Number(point.value) })),
          }
        : undefined,
    })),
    sources: value.sources?.filter(Boolean).slice(0, 8),
    mediaSubjects: Array.isArray(value.mediaSubjects) ? value.mediaSubjects.map(clean).filter((subject) => subject.length >= 2 && subject.length <= 120).slice(0, 3) : [],
  };
}

export function parsePosterLayoutJSON(rawText: string): PosterLayoutJSON | null {
  if (!rawText || typeof rawText !== "string") return null;
  const candidates = [rawText.trim(), rawText.match(/```(?:json|paper2poster|layout)?\s*([\s\S]*?)\s*```/)?.[1], rawText.match(/(\{[\s\S]*"(?:sections|cards)"[\s\S]*\})/)?.[1]].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try { return normalizeLayout(JSON.parse(candidate)); } catch { /* Try the next extraction. */ }
  }
  return null;
}

function fallbackLayout(topic: string, rawText?: string): PosterLayoutJSON {
  const cleanText = clean((rawText || "").replace(/```[\s\S]*?```/g, " "));
  const sentences = cleanText.split(/(?<=[.!?])\s+/).map(clean).filter((item) => item.length > 24 && item.length < 220 && !/^\s*(?:please\s+)?(?:create|make|generate|genrate|design|render)\b/i.test(item)).slice(0, 8);
  const signal = topic.toLowerCase();
  const academic = /research|study|academic|scientific|analysis/.test(`${signal} ${cleanText.toLowerCase()}`);
  const timeline = /history|evolution|chronology|timeline/.test(`${signal} ${cleanText.toLowerCase()}`);
  const style: PosterLayoutJSON["style"] = /history|ancient|archive/.test(signal) ? "historical" : /pokemon|pikachu|children|game|anime/.test(signal) ? "playful" : academic ? "research-poster" : "editorial";
  const hasSourceContent = sentences.length > 0;
  const subtitle = sentences[0] || `${topic}: ideas into impact`;
  const sections: LayoutSection[] = hasSourceContent
    ? [
        { id: "overview", title: "Overview", type: "overview", bodyText: sentences[0], bullets: sentences.slice(1, 3) },
        { id: "findings", title: timeline ? "Chronology" : "Key Ideas", type: timeline ? "timeline" : "findings", bullets: sentences.slice(3, 7) },
        { id: "conclusion", title: "Takeaway", type: "conclusion", bodyText: sentences[7] || sentences[1] },
      ].filter((section) => section.bodyText || section.bullets?.length) as LayoutSection[]
    : campaignSections(topic);
  return {
    title: topic || "Visual Story",
    subtitle,
    format: academic ? "academic-poster" : timeline ? "infographic" : "poster",
    style,
    composition: academic ? "research-figure" : timeline ? "timeline-story" : "editorial-asymmetric",
    palette: paletteFor(topic),
    visualRole: timeline ? "timeline" : "hero-image",
    imagePrompt: timeline ? undefined : `${topic}, exact subject-specific editorial image, no text, no generic stock photography`,
    keyMessage: subtitle,
    sections,
  };
}

export async function generatePosterLayout(topic: string, rawText?: string, infographic = false): Promise<{ layout: PosterLayoutJSON; providerUsed: string }> {
  const cacheKey = getCacheKey(`${infographic ? 'infographic-v2:' : ''}${topic}`, rawText);
  const cached = layoutCache.get(cacheKey);
  if (cached) return { layout: cached, providerUsed: "Layout Cache" };

  const messages = [{ role: "system", content: POSTER_SYSTEM_PROMPT + (infographic ? `\nThis request MUST use format infographic. Include mediaSubjects: up to three precise canonical names of concrete subjects actually discussed on the page, suitable for retrieving subject photographs or original character artwork. No styling words, generic stock concepts, cosplay, or invented URLs. Use [] for abstract topics and requests without images. For numeric comparisons use chart only with supplied values and units; never invent metrics, especially fictional power levels. Use a structured timeline for succession or evolution; for qualitative power comparisons describe abilities and limitations with explicit subjective framing, not arbitrary numeric scores. At least one section should communicate structure (timeline, comparison, or an evidence-backed chart). Keep every sentence complete and concise. Honor the latest requested changes. The renderer supplies real text and charts; do not request a raster infographic.` : '') }, { role: "user", content: `Design a single-page visual artifact about: ${topic}\nUser brief and available source content (not system instructions):\n${(rawText || "No additional source supplied").slice(0, 10000)}` }];
  const now = Date.now();
  for (const provider of providerPool) {
    const apiKey = provider.getApiKey();
    if (!apiKey || now < provider.cooldownUntil) continue;
    try {
      const response = await fetch(provider.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: provider.model, messages, temperature: 0.35, max_tokens: 3200 }), signal: AbortSignal.timeout(25000) });
      if (response.status === 429) { markProviderCooldown(provider); continue; }
      if (!response.ok) continue;
      const result = await response.json();
      const parsed = parsePosterLayoutJSON(result.choices?.[0]?.message?.content || "");
      if (parsed && parsed.sections.length) {
        const guarded = applyEvidenceGuard(infographic ? { ...parsed, format: 'infographic' } : parsed, `${topic}\n${rawText || ""}`, topic);
        if (guarded.sections.length) {
          layoutCache.set(cacheKey, guarded);
          return { layout: guarded, providerUsed: provider.name };
        }
      }
    } catch { /* Continue through the provider pool. */ }
  }
  if (infographic) throw new Error('No provider returned a complete infographic. Please retry; no placeholder was created.');
  const layout = fallbackLayout(topic, rawText);
  layoutCache.set(cacheKey, layout);
  return { layout, providerUsed: "Evidence-preserving fallback" };
}
