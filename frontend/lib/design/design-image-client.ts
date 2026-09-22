import type { PresentationData, Slide } from "@/types/presentation";
import { isUsableWebImageUrl } from "./visual-design-engine";

export type ImageGeneration = { revision: number; requestKey?: string; modelUsed?: string; generated?: boolean };
type ImageSlide = Slide & { imageGeneration?: ImageGeneration };
export type DesignImageRequest = {
  subject: string;
  prompt: string;
  quality: "medium";
  format: "presentation" | "poster" | "infographic";
  seed: number;
};
export type DesignImageResult = { url: string; modelUsed: string; generated: true };

function stableHash(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function imageRequestFor(data: PresentationData, slide: ImageSlide): DesignImageRequest | null {
  if (data.hideImages || !slide.imagePrompt?.trim()) return null;
  // Documentary evidence and data figures require real sources/native rendering.
  if (!["hero-image", "product-image", "annotated-image"].includes(slide.visualRole || "")) return null;
  if (["timeline", "process", "cycle", "hierarchy", "diagram", "matrix", "quadrant", "big-stat", "stats-grid", "quote", "references", "code"].includes(slide.layout)) return null;
  const strategy = data.designPlan?.imageStrategy || "";
  if (/\b(?:no images|no generated|no ai|web.only|verified.only|documentary.only)\b/i.test(strategy)) return null;
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
  return { subject: data.designPlan?.subject || data.title, prompt, quality: "medium", format, seed: stableHash(`${data.id}:${slide.id}:${slide.imageGeneration?.revision || 0}`) };
}

export function imageRequestKey(request: DesignImageRequest) {
  return JSON.stringify(request);
}

export function plannedImageRequests(data: PresentationData) {
  // Select slots BEFORE excluding completed images, so completing two images never
  // starts a third. Existing relevant web images fill their slots without a request.
  return data.slides.flatMap((slide) => {
    const request = imageRequestFor(data, slide);
    return request ? [{ slideId: slide.id, request, key: imageRequestKey(request), complete: isUsableWebImageUrl(slide.imageUrl) }] : [];
  }).slice(0, data.format === "presentation" || !data.format ? 2 : 1).filter((item) => !item.complete);
}

// Shared between stage, thumbnails, remounts and Strict Mode effect replays.
// Rejected requests stay cached too: only a user's retry revision spends again.
const requests = new Map<string, Promise<DesignImageResult>>();
export function requestDesignImage(request: DesignImageRequest): Promise<DesignImageResult> {
  const key = imageRequestKey(request);
  const existing = requests.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const response = await fetch("/api/design-image", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request), signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The configured image providers could not generate this visual.");
    if (payload.generated !== true || typeof payload.modelUsed !== "string" || !isUsableWebImageUrl(payload.url)) {
      throw new Error("The image service did not return a completed image with provenance.");
    }
    return { url: payload.url, modelUsed: payload.modelUsed, generated: true } as DesignImageResult;
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
    ...item, imageUrl: result.url,
    visualCaption: `AI-generated illustration · ${result.modelUsed}`,
    imageGeneration: { revision: slide.imageGeneration?.revision || 0, requestKey, modelUsed: result.modelUsed, generated: true },
  }) };
}
