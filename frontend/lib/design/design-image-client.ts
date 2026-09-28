import type { PresentationData, Slide } from "@/types/presentation";
import { isUsableWebImageUrl } from "./visual-design-engine";
import { supabase } from "@/lib/supabase";

export type ImageGeneration = NonNullable<Slide["imageGeneration"]>;
type ImageSlide = Slide & { imageGeneration?: ImageGeneration };
export type DesignImageRequest = {
  subject: string;
  prompt: string;
  grounding: string;
  source: "auto" | "reference";
  quality: "medium";
  format: "presentation" | "poster" | "infographic";
  seed: number;
};
export type DesignImageResult = { url?: string; modelUsed: string; generated: boolean; omitted?: boolean; sourceUrl?: string; caption?: string; notice?: string };

function stableHash(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function imageRequestFor(data: PresentationData, slide: ImageSlide): DesignImageRequest | null {
  if (data.hideImages || !slide.imagePrompt?.trim()) return null;
  // Documentary evidence and data figures require real sources/native rendering.
  if (!["hero-image", "product-image", "annotated-image", "documentary-image"].includes(slide.visualRole || "")) return null;
  if (["timeline", "process", "cycle", "hierarchy", "diagram", "matrix", "quadrant", "big-stat", "stats-grid", "quote", "references", "code"].includes(slide.layout)) return null;
  const strategy = data.designPlan?.imageStrategy || "";
  if (/\b(?:no images)\b/i.test(strategy)) return null;
  const format = data.format === "presentation" || !data.format ? "presentation" : data.format === "infographic" ? "infographic" : "poster";
  const crop = slide.layout === "full-bleed" || slide.layout === "hero"
    ? "Wide landscape, subject in right third, calm negative space on left for a native heading."
    : format === "presentation" ? "Portrait-friendly central crop for a half-slide image panel; one clear focal subject."
      : "Tall central composition for a poster figure panel, generous clear margins.";
  const palette = data.designPlan?.palette;
  const prompt = [
    slide.imagePrompt.trim().slice(0, 1000),
    `Context: ${slide.title}. ${crop}`,
    `Art direction: ${data.designPlan?.style || "editorial"}; ${data.designPlan?.tone || "clear and expressive"}.`,
    palette ? `Colors: ${palette.primary}, ${palette.secondary}, ${palette.accent}; ground ${palette.background}.` : "",
    "Create only the supporting visual, with no text, lettering, logos, labels, charts, invented measurements or watermark. This is an illustration, never documentary evidence. Keep the subject and metaphor relevant to the brief.",
  ].filter(Boolean).join(" ");
  const source = slide.visualRole === "documentary-image" || /\b(?:no generated|no ai|web.only|verified.only|documentary.only)\b/i.test(strategy) ? "reference" : "auto";
  const grounding = [slide.title, slide.subtitle, slide.content.bodyText, ...(slide.content.bullets || []), slide.imageSubject].filter(Boolean).join(" ");
  return { subject: (slide.imageSubject || slide.title || data.designPlan?.subject || data.title).slice(0, 120), prompt, grounding, source, quality: "medium", format, seed: stableHash(`${data.id}:${slide.id}:${slide.imageGeneration?.revision || 0}`) };
}

export function imageRequestKey(request: DesignImageRequest) {
  return JSON.stringify(request);
}

export function plannedImageRequests(data: PresentationData) {
  // Reserve a sparse, stable set of visual slots before excluding completed or
  // failed slots. Other slides retain native text, diagrams and charts.
  return data.slides.flatMap((slide) => {
    const request = imageRequestFor(data, slide);
    return request ? [{ slideId: slide.id, request, key: imageRequestKey(request), complete: isUsableWebImageUrl(slide.imageUrl) || slide.imageGeneration?.requestKey === imageRequestKey(request) }] : [];
  }).slice(0, data.format === "presentation" || !data.format ? Math.min(12, Math.ceil(data.slides.length * 0.6)) : 1).filter((item) => !item.complete);
}

// Shared between stage, thumbnails, remounts and Strict Mode effect replays.
// Rejected requests stay cached too: only a user's retry revision spends again.
const requests = new Map<string, Promise<DesignImageResult>>();
let activeRequests = 0;
const waitingRequests: Array<() => void> = [];
async function acquireImageSlot() {
  if (activeRequests < 2) { activeRequests++; return; }
  await new Promise<void>(resolve => waitingRequests.push(resolve));
}
function releaseImageSlot() {
  const next = waitingRequests.shift();
  if (next) next(); else activeRequests--;
}
export async function requestDesignImage(request: DesignImageRequest): Promise<DesignImageResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const key = `${session?.user.id || 'anonymous'}:${imageRequestKey(request)}`;
  const existing = requests.get(key);
  if (existing) return existing;
  const pending = (async () => {
    await acquireImageSlot();
    try {
      const response = await fetch("/api/design-image", {
        method: "POST", headers: { "Content-Type": "application/json",
          ...(session?.access_token ? { "x-void-user-token": session.access_token } : {}) },
        body: JSON.stringify(request), signal: AbortSignal.timeout(180_000),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The configured image providers could not generate this visual.");
      if (typeof payload.generated !== "boolean" || typeof payload.modelUsed !== "string" || (!payload.omitted && !isUsableWebImageUrl(payload.url))) {
        throw new Error("The image service did not return a completed image with provenance.");
      }
      return payload as DesignImageResult;
    } finally { releaseImageSlot(); }
  })();
  requests.set(key, pending);
  return pending;
}

export function attachGeneratedImage(data: PresentationData, slideId: string, requestKey: string, result: DesignImageResult): PresentationData {
  const slide = data.slides.find((item) => item.id === slideId) as ImageSlide | undefined;
  const request = slide && imageRequestFor(data, slide);
  // A late result must never overwrite a newer prompt, user image, or hidden media.
  if (!slide || isUsableWebImageUrl(slide.imageUrl) || !request || imageRequestKey(request) !== requestKey) return data;
  return { ...data, slides: data.slides.map((item) => item.id !== slideId ? item : {
    ...item, imageUrl: result.url && !data.slides.some(other => other.id !== slideId && other.imageUrl === result.url) ? result.url : undefined,
    visualCaption: result.generated ? `AI-generated illustration · ${result.modelUsed}` : [result.caption || "Verified web reference", result.sourceUrl].filter(Boolean).join(" · "),
    imageGeneration: { revision: slide.imageGeneration?.revision || 0, requestKey, modelUsed: result.modelUsed, generated: result.generated,
      status: result.omitted || data.slides.some(other => other.id !== slideId && other.imageUrl === result.url) ? "omitted" : "completed",
      message: result.notice, sourceUrl: result.sourceUrl },
  }) };
}

export function attachImageFailure(data: PresentationData, slideId: string, requestKey: string, message: string): PresentationData {
  const slide = data.slides.find(item => item.id === slideId);
  const request = slide && imageRequestFor(data, slide);
  if (!slide || slide.imageUrl || !request || imageRequestKey(request) !== requestKey) return data;
  return { ...data, slides: data.slides.map(item => item.id !== slideId ? item : { ...item,
    imageGeneration: { revision: slide.imageGeneration?.revision || 0, requestKey, status: "failed", message },
  }) };
}
