import type {
  ArtifactFormat,
  DesignPalette,
  DesignPlan,
  DesignStyle,
  PresentationData,
  Slide,
  SlideLayout,
  VisualRole,
} from "@/types/presentation";

export const DESIGN_STYLES: Array<{ value: DesignStyle; label: string }> = [
  { value: "editorial", label: "Editorial" },
  { value: "academic", label: "Academic" },
  { value: "scientific", label: "Scientific" },
  { value: "minimal", label: "Minimal" },
  { value: "modern", label: "Modern" },
  { value: "corporate", label: "Corporate" },
  { value: "luxury", label: "Luxury" },
  { value: "futuristic", label: "Futuristic" },
  { value: "playful", label: "Playful" },
  { value: "youthful", label: "Youthful" },
  { value: "documentary", label: "Documentary" },
  { value: "historical", label: "Historical" },
  { value: "cinematic", label: "Cinematic" },
  { value: "brutalist", label: "Brutalist" },
  { value: "magazine", label: "Magazine" },
  { value: "museum", label: "Museum / Exhibition" },
  { value: "technology", label: "Technology" },
  { value: "data-focused", label: "Data-focused" },
  { value: "infographic-heavy", label: "Infographic-heavy" },
  { value: "educational", label: "Educational" },
  { value: "creative", label: "Creative" },
  { value: "premium", label: "Premium" },
  { value: "bold-typography", label: "Bold Typography" },
  { value: "research-poster", label: "Research Poster" },
  { value: "conference-poster", label: "Conference Poster" },
];

const PALETTES: Record<string, DesignPalette> = {
  academic: { background: "#F3F0E8", surface: "#FFFDF8", text: "#152A35", muted: "#64717A", primary: "#0C5267", secondary: "#8A3B2E", accent: "#D9A441" },
  scientific: { background: "#F4F7F5", surface: "#FFFFFF", text: "#14251F", muted: "#62716B", primary: "#176B57", secondary: "#245C8A", accent: "#D77A2B" },
  historical: { background: "#EDE7DB", surface: "#F8F4EC", text: "#241F1A", muted: "#73695D", primary: "#7A2E25", secondary: "#314A55", accent: "#B78B3A" },
  playful: { background: "#FFF7E8", surface: "#FFFFFF", text: "#1F2940", muted: "#677189", primary: "#E63961", secondary: "#147D92", accent: "#F2B134" },
  luxury: { background: "#F7F5F0", surface: "#FFFEFB", text: "#171717", muted: "#77736B", primary: "#171717", secondary: "#6F5B3E", accent: "#B4904F" },
  cinematic: { background: "#090B0E", surface: "#11151A", text: "#F4F1E8", muted: "#AAA69D", primary: "#E8B44C", secondary: "#7C2F35", accent: "#E8B44C" },
  technology: { background: "#0C1114", surface: "#151C20", text: "#F1F5F4", muted: "#91A09B", primary: "#44C7A1", secondary: "#4E83B8", accent: "#E0B44D" },
  finance: { background: "#F3F5F1", surface: "#FFFFFF", text: "#14231D", muted: "#65716B", primary: "#185C45", secondary: "#2F5873", accent: "#C68A2D" },
  space: { background: "#07090E", surface: "#10141B", text: "#F4F6F8", muted: "#939CA8", primary: "#8EB9E8", secondary: "#B48CC8", accent: "#E8C56B" },
  editorial: { background: "#F4F1EA", surface: "#FFFDF8", text: "#171717", muted: "#6B6760", primary: "#C34232", secondary: "#1D596B", accent: "#E3A62F" },
  ocean: { background: "#ECF8FC", surface: "#FFFFFF", text: "#073747", muted: "#436674", primary: "#007C91", secondary: "#185AC4", accent: "#F1AE36" },
  nature: { background: "#EFF6E8", surface: "#FFFFFF", text: "#19392B", muted: "#526B58", primary: "#286743", secondary: "#696F28", accent: "#D7A129" },
  creative: { background: "#F5EDFF", surface: "#FFFFFF", text: "#2E154D", muted: "#695878", primary: "#762CC4", secondary: "#CB285D", accent: "#FFBE36" },
  modern: { background: "#EDF3FF", surface: "#FFFFFF", text: "#142754", muted: "#516484", primary: "#2455D6", secondary: "#6552B0", accent: "#E46A2F" },
  brutalist: { background: "#FFF9DC", surface: "#FFFFFF", text: "#171717", muted: "#555046", primary: "#D63223", secondary: "#151515", accent: "#F0C629" },
  minimal: { background: "#FAFAFA", surface: "#FFFFFF", text: "#202020", muted: "#616161", primary: "#303030", secondary: "#555555", accent: "#777777" },
};

const PRESENTATION_SEQUENCE: SlideLayout[] = [
  "full-bleed", "editorial", "big-stat", "timeline", "comparison", "process", "image-feature", "research-findings", "quote", "closing",
];

const POSTER_SEQUENCE: SlideLayout[] = ["poster", "asymmetric", "editorial"];
const GENERAL_SEQUENCE: SlideLayout[] = ["editorial", "asymmetric", "research-findings", "split"];
const ARTIFACT_FORMATS: ArtifactFormat[] = [
  "presentation", "poster", "academic-poster", "infographic", "report", "research-summary",
  "one-page-brief", "study-sheet", "handout", "flyer", "brochure", "visual-roadmap",
];

function clean(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\s+/g, " ").trim()
    : "";
}

// Compatibility name: this accepts completed generated assets as well as web media.
// Generation endpoints are deliberately excluded: rendering must never spend credits.
export function isUsableWebImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || /[\\\s\u0000-\u001f]/.test(value)) return false;
  if (/^\/api\/generated-image\/[a-f0-9-]{36}\.(?:png|jpg|webp)(?:\?[^#]*)?$/i.test(value)) return true;
  if (/^\/generated_posters\/poster_[a-z0-9_-]+\.(?:png|jpg|jpeg|webp|svg)(?:\?[^#]*)?$/i.test(value)) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password
      && !/\/(?:api\/)?(?:design-image|generate-image)(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function shorten(value: string, max: number): string {
  const text = clean(value);
  if (text.length <= max) return text;
  const clipped = text.slice(0, max + 1);
  const boundary = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("; "), clipped.lastIndexOf(", "), clipped.lastIndexOf(" "));
  return `${clipped.slice(0, boundary > max * 0.65 ? boundary : max).trim()}...`;
}

function stringList(...values: unknown[]): string[] {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [])
    .map((value) => typeof value === "string" ? clean(value) : "")
    .filter(Boolean);
}

function objectList<T>(...values: unknown[]): T[] {
  const first = values.find((value) => Array.isArray(value) && value.length > 0);
  return Array.isArray(first) ? first.filter((item): item is T => Boolean(item) && typeof item === "object") : [];
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeComparison(value: unknown, bullets: string[]): Slide["content"]["comparison"] {
  const comparison = objectRecord(value);
  const columns = Array.isArray(comparison?.columns) ? comparison.columns : [];
  const leftSource = objectRecord(comparison?.left ?? comparison?.before ?? columns[0]);
  const rightSource = objectRecord(comparison?.right ?? comparison?.after ?? columns[1]);

  if (!comparison && columns.length === 0) return undefined;

  const normalizeColumn = (
    source: Record<string, unknown> | null,
    fallbackTitle: string,
    fallbackPoints: string[],
  ) => ({
    title: clean(source?.title || source?.label || source?.name) || fallbackTitle,
    points: stringList(source?.points, source?.bullets, source?.items).slice(0, 5).length
      ? stringList(source?.points, source?.bullets, source?.items).slice(0, 5)
      : fallbackPoints,
  });

  return {
    left: normalizeColumn(leftSource, "Before", bullets.slice(0, 3)),
    right: normalizeColumn(rightSource, "After", bullets.slice(3, 6)),
  };
}

function slideRecord(slide: Slide): Record<string, unknown> {
  return slide as unknown as Record<string, unknown>;
}

function contentRecord(slide: Slide): Record<string, unknown> {
  return slide.content && typeof slide.content === "object" && !Array.isArray(slide.content)
    ? slide.content as unknown as Record<string, unknown>
    : {};
}

function extractContentBank(slides: Slide[]): string[] {
  const bank = slides.flatMap((slide) => {
    const legacy = slideRecord(slide);
    const content = contentRecord(slide);
    const nestedCards = objectList<Record<string, unknown>>(content.characterCards, legacy.characterCards)
      .flatMap((item) => [clean(item.description), clean(item.details), clean(item.content)]);
    return [
      clean(slide.subtitle),
      clean(content.bodyText),
      clean(content.text),
      clean(content.description),
      clean(content.summary),
      clean(legacy.bodyText),
      clean(legacy.description),
      clean(legacy.summary),
      ...stringList(content.bullets, content.points, content.items, content.findings, content.facts, legacy.bullets, legacy.points, legacy.items, legacy.findings, legacy.facts),
      ...nestedCards,
    ].filter((value) => value.length > 18);
  });
  return [...new Set(bank)];
}

function relevantBankContent(title: string, bank: string[]): string[] {
  const titleWords = new Set(clean(title).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
  return [...bank]
    .map((text, index) => ({
      text,
      index,
      score: text.toLowerCase().split(/[^a-z0-9]+/).reduce((total, word) => total + (titleWords.has(word) ? 1 : 0), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ text }) => text);
}

function inferFormat(data: PresentationData): ArtifactFormat {
  if (typeof data.format === "string" && ARTIFACT_FORMATS.includes(data.format as ArtifactFormat)) {
    return data.format as ArtifactFormat;
  }
  const signal = `${data.title} ${data.slides?.map((slide) => `${slide.layout} ${slide.sectionLabel || ""}`).join(" ")}`.toLowerCase();
  if (/academic|research|conference/.test(signal) && /poster/.test(signal)) return "academic-poster";
  if (/poster|banner/.test(signal)) return "poster";
  if (/infographic/.test(signal)) return "infographic";
  if (/study sheet|cheat sheet/.test(signal)) return "study-sheet";
  if (/report|brief|research summary/.test(signal)) return "research-summary";
  if (/flyer/.test(signal)) return "flyer";
  return "presentation";
}

function inferStyle(subject: string, format: ArtifactFormat, requested?: DesignStyle): DesignStyle {
  if (DESIGN_STYLES.some(({ value }) => value === requested)) return requested!;
  const signal = subject.toLowerCase();
  if (format === "academic-poster") return "research-poster";
  // Word boundaries matter: software, rewards and forward are not about war.
  if (/\b(space|astronomy|cosmos|planets?|galax\w*|universe|nebula|solar system)\b/.test(signal)) return "cinematic";
  if (/\b(technology|software|robots?|robotics|cyber\w*|quantum|artificial intelligence|ai|comput\w*|digital)\b/.test(signal)) return "technology";
  if (/\b(history|historical|wars?|ancient|archives?|civilizations?|medieval|empire)\b/.test(signal)) return "historical";
  if (/\b(biology|medical|health|physics|chemistry|science|climate|water|ocean\w*|ecology|energy|sustainab\w*)\b/.test(signal)) return "scientific";
  if (/\b(finance|markets?|invest\w*|econom\w*|business|revenue)\b/.test(signal)) return "data-focused";
  if (/\b(pok[eé]mon|pikachu|children|school|games?|gaming|anime|comics?|toys?)\b/.test(signal)) return "playful";
  if (/\b(luxury|fashion|jewelry|architecture|interiors?)\b/.test(signal)) return "luxury";
  if (/\b(music|festival|art|design|dance|creativity|food|travel)\b/.test(signal)) return "creative";
  if (format === "poster" || format === "flyer") return "bold-typography";
  if (format === "infographic") return "infographic-heavy";
  return "editorial";
}

function paletteFor(subject: string, style: DesignStyle, inferTopic = true): DesignPalette {
  const signal = subject.toLowerCase();
  if (inferTopic) {
    if (/\b(water|oceans?|marine|rivers?|hydro\w*)\b/.test(signal)) return PALETTES.ocean;
    if (/\b(climate|forests?|ecology|nature|sustainab\w*|renewable|plants?)\b/.test(signal)) return PALETTES.nature;
    if (/\b(space|astronomy|cosmos|planets?|galax\w*|universe|solar system)\b/.test(signal)) return PALETTES.space;
    if (/\b(finance|markets?|invest\w*|econom\w*)\b/.test(signal)) return PALETTES.finance;
  }
  if (PALETTES[style]) return PALETTES[style];
  if (["cinematic", "futuristic"].includes(style)) return PALETTES.cinematic;
  if (["corporate", "educational", "infographic-heavy"].includes(style)) return PALETTES.modern;
  if (["youthful"].includes(style)) return PALETTES.playful;
  if (["magazine"].includes(style)) return PALETTES.creative;
  if (["bold-typography"].includes(style)) return PALETTES.brutalist;
  if (["data-focused"].includes(style)) return PALETTES.finance;
  if (["museum", "documentary"].includes(style)) return PALETTES.historical;
  if (["luxury", "premium"].includes(style)) return PALETTES.luxury;
  if (["academic", "research-poster", "conference-poster"].includes(style)) return PALETTES.academic;
  return PALETTES.editorial;
}

function normalizePalette(value: unknown, fallback: DesignPalette): DesignPalette {
  const palette = objectRecord(value);
  const color = (key: keyof DesignPalette): string => {
    const candidate = clean(palette?.[key]);
    return /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(candidate) ? candidate : fallback[key];
  };
  return {
    background: color("background"),
    surface: color("surface"),
    text: color("text"),
    muted: color("muted"),
    primary: color("primary"),
    secondary: color("secondary"),
    accent: color("accent"),
  };
}

function inferVisualRole(slide: Slide, layout: SlideLayout): VisualRole {
  if (["none", "typography"].includes(slide.visualRole || "")) return slide.visualRole!;
  if (slide.imagePrompt && ["hero-image", "product-image", "annotated-image", "documentary-image"].includes(slide.visualRole || "")) return slide.visualRole!;
  if (slide.imagePrompt && !slide.visualRole && ["hero", "full-bleed", "poster", "image-feature", "asymmetric", "editorial", "split"].includes(layout)) return "hero-image";
  if (slide.content?.chart?.data?.length) return "chart";
  if (slide.content?.timeline?.length || layout === "timeline") return "timeline";
  if (["diagram", "process", "cycle", "hierarchy"].includes(layout)) return "diagram";
  if (isUsableWebImageUrl(slide.imageUrl)) {
    return slide.visualRole && !["none", "typography", "chart", "timeline", "diagram"].includes(slide.visualRole)
      ? slide.visualRole
      : "documentary-image";
  }
  if (["hero", "full-bleed", "image-feature", "gallery", "annotated-image"].includes(layout)) return "typography";
  if (["big-stat", "quote", "section-header", "closing"].includes(layout)) return "typography";
  return slide.visualRole && ["none", "typography", "chart", "timeline", "diagram"].includes(slide.visualRole)
    ? slide.visualRole
    : "none";
}

function chooseLayout(slide: Slide, index: number, format: ArtifactFormat): SlideLayout {
  const content = slide.content || {};
  if (format !== "presentation") return slide.layout === "raster-poster" ? "raster-poster" : "poster";
  const hasVisual = isUsableWebImageUrl(slide.imageUrl) || Boolean(slide.imagePrompt && ["hero-image", "product-image", "annotated-image"].includes(slide.visualRole || ""));
  const supported = ["full-bleed", "hero", "editorial", "asymmetric", "split", "image-feature", "annotated-image", "research-findings", "references", "closing", "section-header"];
  if (supported.includes(slide.layout) && (!["image-feature", "annotated-image"].includes(slide.layout) || hasVisual)) return slide.layout;
  if (content.matrix?.items?.length) return slide.layout === "quadrant" ? "quadrant" : "matrix";
  if (content.metrics && content.metrics.length > 1 || content.factCards?.length) return "stats-grid";
  if (content.chart?.data?.length || content.metrics?.length === 1) return "big-stat";
  if (content.timeline?.length) return "timeline";
  if (content.comparison) return "comparison";
  if (content.process?.length) return ["cycle", "hierarchy", "diagram"].includes(slide.layout) ? slide.layout : "process";
  if (content.quote?.text) return "quote";
  if (index === 0) return "full-bleed";
  if (hasVisual) return "image-feature";
  if (content.codeSnippet?.code) return "code";
  return GENERAL_SEQUENCE[index % GENERAL_SEQUENCE.length];
}

function normalizeSlide(slide: Slide, index: number, format: ArtifactFormat, subject: string, keyMessage: string, contentBank: string[]): Slide {
  const legacy = slideRecord(slide);
  const sourceContent = contentRecord(slide);
  const rawContent = slide.content as unknown;
  const characterDescriptions = objectList<Record<string, unknown>>(sourceContent.characterCards, legacy.characterCards)
    .map((item) => clean(item.description || item.details || item.content || item.text))
    .filter(Boolean);
  let bullets = [
    ...(Array.isArray(rawContent) ? rawContent.map((item) => clean(item)) : []),
    ...stringList(sourceContent.bullets, sourceContent.points, sourceContent.items, sourceContent.findings, sourceContent.facts, legacy.bullets, legacy.points, legacy.items, legacy.findings, legacy.facts),
    ...characterDescriptions,
  ].filter(Boolean);
  bullets = [...new Set(bullets)];

  const contentText = typeof rawContent === "string" ? rawContent : "";
  let bodyText = clean(
    sourceContent.bodyText || sourceContent.text || sourceContent.description || sourceContent.summary ||
    legacy.bodyText || legacy.text || legacy.description || legacy.summary || contentText
  );
  const subtitle = clean(slide.subtitle || legacy.tagline || sourceContent.subtitle);
  const title = clean(slide.title) || `${subject}: ${index + 1}`;

  const metrics = objectList<NonNullable<Slide["content"]["metrics"]>[number]>(sourceContent.metrics, legacy.metrics);
  const factCards = objectList<NonNullable<Slide["content"]["factCards"]>[number]>(sourceContent.factCards, legacy.factCards);
  const timeline = objectList<NonNullable<Slide["content"]["timeline"]>[number]>(sourceContent.timeline, legacy.timeline);
  const process = objectList<NonNullable<Slide["content"]["process"]>[number]>(sourceContent.process, sourceContent.steps, legacy.process, legacy.steps);
  const comparison = normalizeComparison(sourceContent.comparison || legacy.comparison, bullets);
  const chart = (sourceContent.chart || legacy.chart) as Slide["content"]["chart"];
  const quote = (sourceContent.quote || legacy.quote) as Slide["content"]["quote"];

  // Only slide decks may intentionally use a content-light opening slide.
  // A one-page poster/infographic is the deliverable itself, so allowing its
  // first (and only) page to bypass repair produced blank title-only canvases.
  const isIntentionalDivider = (format === "presentation" && index === 0)
    || ["section-header", "quote", "closing"].includes(slide.layout);
  const hasMeaningfulContent = Boolean(bodyText || bullets.length || metrics.length || factCards.length || timeline.length || process.length || comparison || chart?.data?.length || quote?.text);
  if (!hasMeaningfulContent && !isIntentionalDivider) {
    const relevant = relevantBankContent(title, contentBank)
      .filter((item) => clean(item) !== title && clean(item) !== subtitle && clean(item) !== keyMessage);
    bodyText = relevant[0] || "";
    bullets = relevant.slice(1, 4);
  }
  if (!bodyText && !bullets.length && subtitle && index > 0) bodyText = subtitle;

  if (format === "presentation") {
    bodyText = shorten(bodyText, 230);
    bullets = bullets.slice(0, 4).map((item) => shorten(item, 125));
  } else {
    bodyText = shorten(bodyText, 760);
    bullets = bullets.slice(0, 6).map((item) => shorten(item, 150));
  }

  const repairedContent: Slide["content"] = {
    ...(sourceContent as Slide["content"]),
    bodyText: bodyText || undefined,
    bullets,
    metrics: metrics.slice(0, 4),
    factCards: factCards.slice(0, 4),
    timeline: timeline.slice(0, 6),
    process: process.slice(0, 6),
    comparison,
    chart,
    quote,
    characterCards: objectList<NonNullable<Slide["content"]["characterCards"]>[number]>(sourceContent.characterCards, legacy.characterCards).slice(0, 5),
    sources: stringList(sourceContent.sources, legacy.sources).slice(0, 8),
    takeaway: shorten(clean(sourceContent.takeaway || legacy.takeaway || bullets[0] || bodyText), 140) || undefined,
  };
  let layout = chooseLayout({ ...slide, content: repairedContent }, index, format);
  const isStillSparse = !bodyText && !subtitle && !bullets.length && !metrics.length && !factCards.length && !timeline.length && !process.length && !comparison && !chart?.data?.length && !quote?.text;
  if (isStillSparse && index > 0 && format === "presentation") layout = "asymmetric";

  const imageUrl = isUsableWebImageUrl(slide.imageUrl) ? slide.imageUrl : undefined;
  if (!imageUrl && !slide.imagePrompt && index > 0 && ["image-feature", "gallery", "annotated-image"].includes(layout)) {
    layout = GENERAL_SEQUENCE[index % GENERAL_SEQUENCE.length];
  }

  const id = slide.id || `slide-${index + 1}`;
  const allowedPositions = new Set(["left top", "center top", "right top", "left center", "center", "right center", "left bottom", "center bottom", "right bottom"]);
  const requestedImagePosition = clean(slide.imagePosition);
  const imagePosition = allowedPositions.has(requestedImagePosition) ? requestedImagePosition as Slide["imagePosition"] : undefined;
  const imageStyleId = `${id}::image`;
  const existingImageStyle = slide.elementStyles?.[imageStyleId];
  const elementStyles = imagePosition
    ? { ...(slide.elementStyles || {}), [imageStyleId]: { ...existingImageStyle, kind: "image" as const, objectPosition: existingImageStyle?.objectPosition || imagePosition } }
    : slide.elementStyles;

  return {
    ...slide,
    id,
    slideNumber: index + 1,
    title,
    subtitle: subtitle || undefined,
    layout,
    visualRole: inferVisualRole({ ...slide, imageUrl, content: repairedContent }, layout),
    imageUrl,
    imagePrompt: clean(slide.imagePrompt) || undefined,
    imagePosition,
    elementStyles,
    content: repairedContent,
  };
}

export function normalizePresentation(input: PresentationData): PresentationData {
  const format = inferFormat(input);
  const subject = clean(input.designPlan?.subject || input.title) || "Untitled subject";
  const topic = /^(untitled|presentation|poster|infographic|overview|introduction|research|slide deck)(\s|$)/i.test(subject)
    ? `${subject} ${input.subtitle || ""} ${(input.slides || []).slice(0, 4).map((slide) => slide.title).join(" ")}` : subject;
  const authoredStyle = DESIGN_STYLES.some(({ value }) => value === input.designPlan?.style);
  const style = inferStyle(topic, format, input.designPlan?.style);
  const fallbackPalette = paletteFor(topic, style, !authoredStyle);
  const plan: DesignPlan = {
    subject,
    audience: input.designPlan?.audience || (format === "academic-poster" ? "academic and research audience" : "general informed audience"),
    purpose: input.designPlan?.purpose || (format === "presentation" ? "explain a clear visual story" : "communicate the central message at a glance"),
    tone: input.designPlan?.tone || style.replace(/-/g, " "),
    keyMessage: input.designPlan?.keyMessage || clean(input.subtitle || input.slides?.[0]?.subtitle || input.title),
    readingDirection: input.designPlan?.readingDirection || "top-to-bottom",
    style,
    density: input.designPlan?.density || (format === "presentation" ? "spacious" : format === "academic-poster" ? "dense" : "balanced"),
    imageStrategy: input.designPlan?.imageStrategy || "Use several distinct, relevant verified web images when evidence matters. For conceptual support, request a detailed Cloudflare or FLUX illustration with an explicit imagePrompt and hero-image or product-image role; keep evidence, charts and labels native.",
    recurringMotif: input.designPlan?.recurringMotif || (style === "playful" ? "Oversized circles and contrasting color fields" : style === "technology" ? "Precise rules and a modular technical grid" : "Strong type, asymmetric framing and recurring color fields"),
    palette: normalizePalette(input.designPlan?.palette, fallbackPalette),
  };

  const sourceSlides = Array.isArray(input.slides) && input.slides.length
    ? input.slides
    : [{ id: "slide-1", slideNumber: 1, layout: "hero" as const, title: subject, content: {} }];

  const contentBank = extractContentBank(sourceSlides);

  const slides = sourceSlides.map((slide, index) => normalizeSlide(slide, index, format, subject, plan.keyMessage, contentBank));
  if (format === "presentation" && slides.length >= 5) {
    const hasConclusion = slides.some((slide) => /\b(?:conclusion|summary|takeaways?|closing)\b/i.test(slide.title) || slide.layout === "closing");
    const hasReferences = slides.some((slide) => /\b(?:sources?|references?|bibliography|works cited)\b/i.test(slide.title) || slide.layout === "references");
    const sourceUrls = [...new Set(slides.flatMap((slide) => slide.content.sources || []).filter(Boolean))];
    if (!hasReferences) {
      const lastSlideIsConclusion = slides[slides.length - 1].layout === "closing" || /\b(?:conclusion|summary|takeaways?|closing|legacy|aftermath)\b/i.test(slides[slides.length - 1].title);
      const sourceIndex = lastSlideIsConclusion ? slides.length - 2 : slides.length - 1;
      const original = slides[sourceIndex];
      slides[sourceIndex] = {
        ...original,
        title: "Sources & further reading",
        subtitle: "References used across this presentation",
        layout: "references",
        visualRole: "typography",
        imageUrl: undefined,
        imagePrompt: undefined,
        content: {
          ...original.content,
          bodyText: sourceUrls.length ? undefined : "No external source URLs were supplied with this draft. Add verified references before publishing.",
          bullets: sourceUrls.slice(0, 6).map((url) => {
            try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return shorten(url, 110); }
          }),
          sources: sourceUrls,
        },
      };
    }
    if (!hasConclusion) {
      const conclusionIndex = Math.max(1, slides.length - 2);
      const original = slides[conclusionIndex];
      const takeaways = slides.slice(1, conclusionIndex + 1)
        .map((slide) => slide.content.takeaway || slide.content.bullets?.[0] || slide.content.bodyText)
        .filter((item): item is string => Boolean(item))
        .slice(-3)
        .map((item) => shorten(item, 115));
      slides[conclusionIndex] = {
        ...original,
        title: "Conclusion",
        subtitle: "What the evidence adds up to",
        layout: "closing",
        visualRole: "typography",
        imageUrl: undefined,
        imagePrompt: undefined,
        content: { ...original.content, bodyText: shorten(plan.keyMessage, 190), bullets: takeaways },
      };
    }
    const referenceIndex = slides.findIndex((slide) => slide.layout === "references" || /\b(?:sources?|references?|bibliography|works cited)\b/i.test(slide.title));
    if (referenceIndex >= 0 && referenceIndex !== slides.length - 1) {
      const [references] = slides.splice(referenceIndex, 1);
      slides.push({ ...references, layout: "references", visualRole: "typography", imageUrl: undefined, imagePrompt: undefined });
    }
    const conclusionIndex = slides.findIndex((slide) => slide.layout === "closing" || /\b(?:conclusion|summary|takeaways?|closing)\b/i.test(slide.title));
    if (conclusionIndex >= 0 && conclusionIndex !== slides.length - 2) {
      const [conclusion] = slides.splice(conclusionIndex, 1);
      slides.splice(Math.max(0, slides.length - 1), 0, { ...conclusion, layout: "closing", visualRole: "typography", imageUrl: undefined, imagePrompt: undefined });
    }
  }

  return {
    ...input,
    id: input.id || `design-${Date.now()}`,
    version: 2,
    format,
    designPlan: plan,
    slides: slides.map((slide, index) => ({ ...slide, slideNumber: index + 1 })),
  };
}

export function withDesignStyle(data: PresentationData, style: DesignStyle): PresentationData {
  const normalized = normalizePresentation(data);
  return {
    ...normalized,
    designPlan: {
      ...normalized.designPlan!,
      style,
      tone: style.replace(/-/g, " "),
      palette: paletteFor(normalized.designPlan!.subject, style, false),
    },
  };
}

export function regenerateSlideLayout(data: PresentationData, slideId: string): PresentationData {
  const normalized = normalizePresentation(data);
  const allCandidates = normalized.format === "presentation"
    ? PRESENTATION_SEQUENCE
    : POSTER_SEQUENCE;
  return {
    ...normalized,
    slides: normalized.slides.map((slide) => {
      if (slide.id !== slideId) return slide;
      const candidates = allCandidates.filter((layout) => chooseLayout({ ...slide, layout }, slide.slideNumber - 1, normalized.format!) === layout);
      if (!candidates.length) return slide;
      const currentIndex = Math.max(0, candidates.indexOf(slide.layout));
      const layout = candidates[(currentIndex + 1) % candidates.length];
      return { ...slide, layout, layoutVariant: (slide.layoutVariant || 0) + 1, visualRole: inferVisualRole(slide, layout) };
    }),
  };
}

export function regenerateSlideImage(data: PresentationData, slideId: string): PresentationData {
  const normalized = normalizePresentation(data);
  return {
    ...normalized,
    slides: normalized.slides.map((slide) => {
      if (slide.id !== slideId) return slide;
      const previous = objectRecord(slideRecord(slide).imageGeneration);
      return {
        ...slide,
        imageUrl: undefined,
        imagePrompt: slide.imagePrompt || `${slide.title}. ${slide.subtitle || slide.content.bodyText || normalized.designPlan!.keyMessage}`,
        visualRole: "hero-image" as const,
        layout: normalized.format === "presentation" ? "image-feature" as const : "poster" as const,
        imageGeneration: { revision: (Number(previous?.revision) || 0) + 1 },
      };
    }),
  };
}

export function applyDesignInstruction(data: PresentationData, instruction: string, slideId?: string): PresentationData {
  let next = normalizePresentation(data);
  const command = instruction.toLowerCase();
  const styleMatch = DESIGN_STYLES.find(({ value, label }) => command.includes(value) || command.includes(label.toLowerCase()));
  if (styleMatch) next = withDesignStyle(next, styleMatch.value);
  if (/fewer cards|less cards|more whitespace|minimal/.test(command)) {
    next = {
      ...next,
      designPlan: { ...next.designPlan!, density: "spacious" },
      slides: next.slides.map((slide, index) => ({
        ...slide,
        layout: index === 0 ? (next.format === "presentation" ? "full-bleed" : "poster") : "editorial",
        content: { ...slide.content, bullets: slide.content.bullets?.slice(0, 3), factCards: slide.content.factCards?.slice(0, 2) },
      })),
    };
  }
  if (/reduce text|less text|shorten/.test(command)) {
    next = {
      ...next,
      slides: next.slides.map((slide) => ({
        ...slide,
        subtitle: slide.subtitle ? shorten(slide.subtitle, 90) : undefined,
        content: { ...slide.content, bodyText: slide.content.bodyText ? shorten(slide.content.bodyText, 170) : undefined, bullets: slide.content.bullets?.slice(0, 3).map((item) => shorten(item, 90)) },
      })),
    };
  }
  if (/stronger title|bold title|title stronger/.test(command)) {
    next = { ...next, designPlan: { ...next.designPlan!, style: "bold-typography" } };
  }
  if (/timeline/.test(command)) {
    const targetId = slideId || next.slides.find((slide) => slide.content.timeline?.length)?.id || next.slides[0].id;
    next = { ...next, slides: next.slides.map((slide) => slide.id === targetId ? { ...slide, layout: "timeline", visualRole: "timeline" } : slide) };
  }
  if (/more visual|image led|image-led|make this slide visual|make this page visual/.test(command)) {
    const targetId = slideId || next.slides[0].id;
    next = { ...next, slides: next.slides.map((slide) => slide.id === targetId ? { ...slide, layout: "image-feature", visualRole: "hero-image" } : slide) };
  }
  if (/replace (this )?image|regenerate (this )?image|new image/.test(command)) {
    const targetId = slideId || next.slides[0].id;
    next = regenerateSlideImage(next, targetId);
  }
  if (/consistent|whole presentation|all slides/.test(command)) {
    next = { ...next, slides: next.slides.map((slide, index) => ({ ...slide, accentColor: next.designPlan!.palette.primary, slideNumber: index + 1 })) };
  }
  return next;
}

export type QualityIssue = { slideId: string; category: string; message: string; severity: "minor" | "major" };

export function scoreDesign(data: PresentationData): { score: number; issues: QualityIssue[] } {
  const normalized = normalizePresentation(data);
  const issues: QualityIssue[] = [];
  const layouts = new Set<SlideLayout>();
  normalized.slides.forEach((slide) => {
    layouts.add(slide.layout);
    const wordCount = `${slide.title} ${slide.subtitle || ""} ${slide.content.bodyText || ""} ${(slide.content.bullets || []).join(" ")}`.split(/\s+/).filter(Boolean).length;
    const limit = normalized.format === "presentation" ? 110 : 220;
    if (wordCount > limit) issues.push({ slideId: slide.id, category: "density", message: "Content is too dense for the selected format.", severity: "major" });
    if (slide.title.length > 92) issues.push({ slideId: slide.id, category: "hierarchy", message: "Title is too long to dominate cleanly.", severity: "minor" });
    const isDivider = ["section-header", "quote", "closing"].includes(slide.layout);
    const supportGroups = [
      (slide.content.bodyText || "").split(/\s+/).filter(Boolean).length >= 24,
      (slide.content.bullets || []).filter((item) => item.split(/\s+/).length >= 5).length >= 2,
      (slide.content.metrics?.length || 0) >= 2 || (slide.content.factCards?.length || 0) >= 2,
      (slide.content.timeline?.length || 0) >= 3 || (slide.content.process?.length || 0) >= 3,
      Boolean(slide.content.comparison || (slide.content.chart?.data?.length || 0) >= 3),
      Boolean(isUsableWebImageUrl(slide.imageUrl) || slide.imagePrompt),
    ].filter(Boolean).length;
    if (slide.slideNumber > 1 && !isDivider && supportGroups < 2 && !(slide.content.timeline?.length && slide.content.timeline.length >= 3) && !(slide.content.process?.length && slide.content.process.length >= 3)) {
      issues.push({ slideId: slide.id, category: "completeness", message: "Page needs another substantive content or visual element.", severity: "major" });
    }
    if (normalized.format !== "presentation" && !normalized.hideImages && !isUsableWebImageUrl(slide.imageUrl) && !slide.imagePrompt) {
      issues.push({ slideId: slide.id, category: "relevance", message: "Poster needs a relevant visual focal point or an explicit visual brief.", severity: "major" });
    }
    if (["hero-image", "documentary-image", "product-image", "annotated-image"].includes(slide.visualRole || "") && !isUsableWebImageUrl(slide.imageUrl)) {
      issues.push({ slideId: slide.id, category: "relevance", message: slide.imagePrompt ? "Planned visual has not been generated yet." : "Image layout needs a relevant image or an explicit visual brief.", severity: slide.imagePrompt ? "minor" : "major" });
    }
  });
  if (normalized.slides.length >= 4 && layouts.size < 3) issues.push({ slideId: normalized.slides[0].id, category: "originality", message: "Layout rhythm repeats too often.", severity: "major" });
  const penalty = issues.reduce((total, issue) => total + (issue.severity === "major" ? 7 : 3), 0);
  return { score: Math.max(0, 100 - penalty), issues };
}

export function imageUrlFor(data: PresentationData, slide: Slide): string | null {
  if (data.hideImages || slide.visualRole === "none") return null;
  if (data.format === "presentation" && (slide.visualRole === "typography" || slide.visualRole === "chart" || slide.visualRole === "timeline" || slide.visualRole === "diagram")) return null;
  if (isUsableWebImageUrl(slide.imageUrl)) {
    return slide.imageUrl.startsWith("/") ? slide.imageUrl : `/api/image-proxy?url=${encodeURIComponent(slide.imageUrl)}`;
  }
  return null;
}
