export type PosterImageSize = "1024x1024" | "1024x1536" | "1536x1024";

const POSTER_REQUEST = /\b(?:posters?|flyers?|cover art|infographics?)\b/i;
const FINISHED_POSTER_MARKER = "Create one finished AI-generated poster";
const FINISHED_INFOGRAPHIC_MARKER = "Create one finished AI-generated infographic";

export function isAiPosterRequest(prompt: string): boolean {
  return POSTER_REQUEST.test(prompt) || prompt.includes(FINISHED_POSTER_MARKER) || prompt.includes(FINISHED_INFOGRAPHIC_MARKER);
}

export function posterTitleFromPrompt(prompt: string): string {
  const explicitTitle = prompt.match(/Display the exact short title\s+["“]([^"”]{1,80})["”]/i)?.[1];
  const topicContext = prompt.match(/Topic to depict:\s*([^.!?]{2,100})/i)?.[1];
  const namedPoster = prompt.match(/(?:posters?|flyers?|cover art|infographics?)\s+(?:about|on|for|of)\s+([^,.!?]{2,100})/i)?.[1];
  const leading = prompt.split(/\.\s*Create one finished/i)[0]
    .replace(/^\s*(?:(?:please|can you|could you)\s+)?(?:make|create|generate|genrate|design|render)\s+(?:an?\s+)?(?:posters?|flyers?|cover art|infographics?)\s*(?:about|on|for|of)?\s*/i, "")
    .trim();

  return (explicitTitle || topicContext || namedPoster || leading || "Visual Story")
    .replace(/\s+/g, " ")
    .replace(/["“”]/g, "")
    .trim()
    .slice(0, 60);
}

export function buildAiPosterPrompt(rawPrompt: string, size: PosterImageSize = "1024x1536"): string {
  const clean = rawPrompt.replace(/\s+/g, " ").trim();
  if (clean.includes(FINISHED_POSTER_MARKER) || clean.includes(FINISHED_INFOGRAPHIC_MARKER)) return clean;

  const title = posterTitleFromPrompt(clean);
  const orientation = size === "1536x1024"
    ? "Use a wide landscape composition."
    : size === "1024x1024"
      ? "Use a square composition."
      : "Use a portrait composition.";

  if (/\binfographics?\b/i.test(clean)) {
    return [
      `User brief: ${clean}.`,
      `${FINISHED_INFOGRAPHIC_MARKER} as one cohesive, premium, high-resolution composition created entirely by the image model.`,
      `Display the exact short title "${title}" once at the top, large and clearly legible.`,
      "Build a deliberate information hierarchy with 6-8 visibly distinct but unified sections: a concise definition, an evolution or process sequence, key components or categories, one comparison, practical selection guidance, and use cases or implications when relevant to the topic.",
      "Use crisp editorial information design: strong grid, generous but efficient spacing, precise alignment, numbered section markers, clean vector icons, small subject illustrations, restrained dimensional accents, and a coherent topic-specific color system.",
      "Make the canvas feel information-rich without becoming cluttered. Give every panel a clear purpose; vary panel sizes to establish primary, secondary, and supporting reading levels. Connect related steps with lines, arrows, or a timeline when useful.",
      "Render headings and short labels as sharp, correctly spelled text. Keep body copy extremely concise and large enough to read. Never fill space with gibberish, pseudo-text, repeated labels, arbitrary numbers, or unsupported claims.",
      "Prefer diagrams, icons, mini comparisons, and visual encodings over paragraphs. Do not create a sparse poster with one photograph and a few columns. Do not show a paper mockup, browser UI, frame, wall, desk, watermark, signature, or editing controls.",
      "For branded or technical subjects, use accurate recognizable product silhouettes and terminology, but do not invent a fake logo or certification badge.",
      orientation,
    ].join(" ");
  }

  return [
    `User brief: ${clean}.`,
    `${FINISHED_POSTER_MARKER} as one cohesive, full-bleed image created entirely by the image model.`,
    `Make the imagery dominant and visually polished, with one clear hero subject, strong hierarchy, balanced negative space, coherent details, and cinematic lighting.`,
    `Display the exact short title "${title}" once, large and clearly legible.`,
    "Do not include any subtitle, caption, paragraph, label, legend, bullet, statistic, date, map text, fine print, logo, watermark, UI, signature, or repeated title.",
    "Do not invent letters or fake text. If the exact title cannot be rendered correctly, omit all text instead.",
    "Do not show a poster sheet, paper edge, border, frame, wall, desk, mockup, blurred duplicate, or background extension.",
    orientation,
  ].join(" ");
}
