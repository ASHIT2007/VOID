import { detectStoredImageMime, MAX_STORED_IMAGE_BYTES } from './generated-image-store';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';

export type ImageQuality = 'low' | 'medium' | 'high';
export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';

export class OpenAIImageError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}

export function openAIImageConfig() {
  // Local image-provider settings explicitly belong to this app. A desktop
  // host may inherit a different API key; it must not shadow .env.local in dev.
  let local: Record<string, string> = {};
  if (process.env.NODE_ENV === 'development') {
    try { local = parse(readFileSync(path.resolve(process.cwd(), '.env.local'))); } catch { /* use deployment environment */ }
  }
  return { apiKey: (local.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY)?.trim(),
    model: local.OPENAI_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    quality: local.OPENAI_IMAGE_QUALITY || process.env.OPENAI_IMAGE_QUALITY };
}

export function configuredImageQuality(value?: unknown): ImageQuality {
  const quality = value || openAIImageConfig().quality;
  return quality === 'low' || quality === 'high' ? quality : 'medium';
}

export async function generateOpenAIImage(prompt: string, options: {
  quality?: ImageQuality; size?: ImageSize; signal?: AbortSignal;
} = {}) {
  const { apiKey, model } = openAIImageConfig();
  if (!apiKey) throw new OpenAIImageError('OpenAI image generation needs OPENAI_API_KEY on the server.', 'not_configured', 503);
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: prompt.slice(0, 16000), n: 1,
        quality: configuredImageQuality(options.quality), size: options.size || '1536x1024', output_format: 'png' }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(150_000)]) : AbortSignal.timeout(150_000),
    });
  } catch {
    throw new OpenAIImageError('OpenAI image generation did not finish. Please retry.', 'generation_timeout', 504);
  }
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ b64_json?: string }>; error?: { code?: string; type?: string };
  };
  if (!response.ok) {
    const code = payload.error?.code || payload.error?.type || 'generation_failed';
    const message = /billing|quota|credit_balance/.test(code) ? 'The selected image service is unavailable for this project. Try another configured provider.'
      : response.status === 401 ? 'OpenAI rejected the configured API key. Update OPENAI_API_KEY and restart the server.'
      : response.status === 403 ? 'This OpenAI API project does not have permission to generate images with the configured model.'
      : response.status === 429 ? 'OpenAI image generation is rate limited. Please retry shortly.'
      : /safety|content_policy/.test(code) ? 'OpenAI could not generate this image because of its content policy. Revise the image brief.'
      : 'OpenAI could not generate the requested image. Please retry or revise the image brief.';
    throw new OpenAIImageError(message, code, response.status);
  }
  const encoded = payload.data?.[0]?.b64_json;
  const bytes = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
  const mimeType = detectStoredImageMime(bytes);
  if (!mimeType || bytes.length < 1000 || bytes.length > MAX_STORED_IMAGE_BYTES) {
    throw new OpenAIImageError('OpenAI returned an unusable image.', 'invalid_image', 502);
  }
  return { bytes, mimeType, modelUsed: `OpenAI ${model}` };
}
