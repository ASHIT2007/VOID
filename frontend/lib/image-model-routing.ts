export const POSTER_IMAGE_MODEL = "Gemini Image";
export const POSTER_CLOUDFLARE_MODEL = "Poster Fallback · Cloudflare";
export const POSTER_FLUX_MODEL = "Poster Fallback · FLUX";
export const POSTER_FALLBACK_MODEL = POSTER_CLOUDFLARE_MODEL;

export type ImageProviderId = "gemini" | "pollinations" | "together" | "cloudflare" | "openai";

export function imageModelForRequest(defaultImageModel: string, isRasterPosterRequest: boolean): string {
  return defaultImageModel || "Auto";
}

/**
 * Keep generation on the model family the user selected. A provider may have
 * more than one endpoint for the same model family (Gemini direct + gateway),
 * but a failed FLUX/Ideogram/Cloudflare request must not silently become a
 * Nano Banana request.
 */
export function imageProviderOrder(model: unknown): ImageProviderId[] {
  const normalized = typeof model === "string" ? model.trim().toLowerCase() : "";
  if (!normalized || normalized === 'auto' || normalized === 'auto image') {
    return ['cloudflare', 'pollinations', 'gemini', 'together', 'openai'];
  }

  if (normalized.includes("gemini") || normalized.includes("nano banana")) {
    return ["gemini", "pollinations"];
  }
  if (normalized === POSTER_CLOUDFLARE_MODEL.toLowerCase()) return ["cloudflare"];
  if (normalized === POSTER_FLUX_MODEL.toLowerCase()) return ["together", "pollinations"];
  if (normalized.includes("cloudflare")) return ["cloudflare"];
  if (normalized.includes("openai") || normalized.includes("gpt image") || normalized.includes("gpt-image")) {
    return ["openai"];
  }

  // FLUX, Ideogram, and the styled FLUX variants are served by the
  // Pollinations generation gateway while preserving the requested model.
  return ["pollinations"];
}

/** Generation preferences are tried first; outages may use another model,
 * whose actual identity is returned with the image. */
export function imageGenerationProviderOrder(model: unknown): ImageProviderId[] {
  if (model === POSTER_CLOUDFLARE_MODEL || model === POSTER_FLUX_MODEL) return imageProviderOrder(model);
  return [...new Set([...imageProviderOrder(model), ...imageProviderOrder('Auto Image')])];
}
