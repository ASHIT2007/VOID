import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { fetchWithRetry } from '@/lib/reliability';
import { readGeneratedImage, storeGeneratedImage } from '@/lib/generated-image-store';

type DesignBrief = { subject?: string; prompt?: string; quality?: unknown; format?: string; seed?: number };
type DesignImage = { id: string; url: string; modelUsed: string; generated: true };
const imageCache = globalThis as typeof globalThis & {
  voidDesignImages?: Map<string, { expires: number; result: Promise<DesignImage> }>;
};
const cache = imageCache.voidDesignImages ??= new Map();
const MIN_IMAGE_BYTES = 8 * 1024;

class ImageServiceError extends Error {
  constructor(message: string, public code = 'generation_failed', public status = 502) { super(message); }
}

function imageMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function completedImage(bytes: Buffer, modelUsed: string) {
  const mimeType = imageMime(bytes);
  if (!mimeType || bytes.length < MIN_IMAGE_BYTES) throw new ImageServiceError(`${modelUsed} returned an invalid image.`);
  return { bytes, mimeType, modelUsed };
}

async function generateWithCloudflare(prompt: string, portrait: boolean) {
  const endpoint = process.env.CLOUDFLARE_SDXL_URL || 'https://image-api.opundefined.workers.dev/';
  const apiKey = process.env.CLOUDFLARE_SDXL_KEY || process.env.IMG2IMG_WORKER_KEY;
  if (!apiKey) throw new ImageServiceError('Cloudflare image generation is not configured.', 'not_configured');
  const response = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ prompt, width: portrait ? 768 : 1344, height: portrait ? 1344 : 768 }),
  }, { attempts: 2, connectTimeoutMs: 90_000, maxDelayMs: 1_000 });
  if (!response.ok) throw new ImageServiceError(`Cloudflare image generation failed (${response.status}).`);
  return completedImage(Buffer.from(await response.arrayBuffer()), 'Cloudflare FLUX.1 Schnell');
}

async function generateWithFlux(prompt: string, portrait: boolean) {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new ImageServiceError('FLUX image generation is not configured.', 'not_configured');
  const failures: string[] = [];
  for (const candidate of [
    { model: 'black-forest-labs/FLUX.1.1-pro', label: 'FLUX 1.1 Pro · Together' },
    { model: 'black-forest-labs/FLUX.1-schnell-Free', label: 'FLUX Schnell · Together' },
  ]) {
    const response = await fetchWithRetry('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: candidate.model,
        prompt: prompt.slice(0, 1800),
        n: 1,
        response_format: 'base64',
        output_format: 'png',
        width: portrait ? 768 : 1344,
        height: portrait ? 1344 : 768,
        negative_prompt: 'text, lettering, logos, watermark, blurry, duplicate background, poster mockup, frame',
      }),
    }, { attempts: 1, connectTimeoutMs: 150_000 });
    if (!response.ok) { failures.push(`${candidate.label} (${response.status})`); continue; }
    const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = payload.data?.[0];
    if (item?.b64_json) return completedImage(Buffer.from(item.b64_json, 'base64'), candidate.label);
    if (item?.url && /^https:\/\//i.test(item.url)) {
      const imageResponse = await fetchWithRetry(item.url, {}, { attempts: 2, connectTimeoutMs: 90_000 });
      if (imageResponse.ok) return completedImage(Buffer.from(await imageResponse.arrayBuffer()), candidate.label);
    }
    failures.push(`${candidate.label} returned no image`);
  }
  throw new ImageServiceError(`FLUX image generation failed: ${failures.join('; ')}`);
}

async function generateDesign(brief: DesignBrief): Promise<DesignImage> {
  const subject = typeof brief.subject === 'string' ? brief.subject.trim().slice(0, 300) : '';
  const prompt = typeof brief.prompt === 'string' ? brief.prompt.trim().slice(0, 8000) : '';
  if (!subject && !prompt) throw new ImageServiceError('A subject or image brief is required.', 'missing_prompt', 400);
  const portrait = /poster|infographic|flyer/.test(brief.format || '');
  const fullPrompt = `Create a purposeful editorial image asset to place inside ${portrait ? 'a portrait poster or infographic' : 'a landscape presentation slide'}. Do not render the poster, slide, page, frame, border, or surrounding mockup itself. Subject: ${subject}.\nVisual brief: ${prompt}\nFollow the specified subject, era, palette, composition, and crop. Leave all text out so the editor can place readable native typography. Preserve factual relationships in diagrams. Do not invent data or depict an invented image as an archival photograph. Avoid unrelated people, decorative stock scenery, watermarks, blurred duplicate backgrounds, and page mockups. Fill the image canvas edge to edge with the requested visual.`;
  const key = createHash('sha256').update(JSON.stringify(['cloudflare-flux-v1', fullPrompt, portrait, brief.seed || 0])).digest('hex');
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  for (const [cacheKey, value] of cache) if (value.expires < Date.now()) cache.delete(cacheKey);
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  const result = (async (): Promise<DesignImage> => {
    let generated;
    try { generated = await generateWithCloudflare(fullPrompt, portrait); }
    catch (cloudflareError) {
      console.warn('[design-image] Cloudflare unavailable; switching to FLUX:', cloudflareError instanceof Error ? cloudflareError.message : cloudflareError);
      generated = await generateWithFlux(fullPrompt, portrait);
    }
    const stored = await storeGeneratedImage(generated.bytes, generated.mimeType);
    return { id: stored.id, url: `/api/generated-image/${stored.id}?void_generated=true&model_name=${encodeURIComponent(generated.modelUsed)}`, modelUsed: generated.modelUsed, generated: true };
  })();
  cache.set(key, { result, expires: Date.now() + 24 * 60 * 60 * 1000 });
  try { return await result; } catch (error) { cache.delete(key); throw error; }
}

function imageError(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Image generation failed.',
    code: error instanceof ImageServiceError ? error.code : 'generation_failed', provider: 'Cloudflare / FLUX' },
  { status: error instanceof ImageServiceError ? error.status : 500 });
}

export async function POST(request: NextRequest) {
  try { return NextResponse.json(await generateDesign(await request.json())); }
  catch (error) { return imageError(error); }
}

// Successful POST URLs are stored on the artifact so reopening a saved deck
// does not make another paid image request. Legacy generation URLs still work.
export async function GET(request: NextRequest) {
  const parameters = request.nextUrl.searchParams;
  if (parameters.get('mode') !== 'generate') {
    return NextResponse.json({ error: 'Use a verified source image URL for web imagery.' }, { status: 404 });
  }
  try {
    const result = await generateDesign({ subject: parameters.get('subject') || '', prompt: parameters.get('prompt') || '',
      quality: parameters.get('quality'), format: parameters.get('format') || '', seed: Number(parameters.get('seed')) || 0 });
    const image = await readGeneratedImage(result.id);
    return new NextResponse(new Uint8Array(image.bytes), { headers: { 'Content-Type': image.mimeType,
      'Cache-Control': 'private, max-age=86400', 'X-Visual-Source': result.modelUsed } });
  } catch (error) { return imageError(error); }
}
