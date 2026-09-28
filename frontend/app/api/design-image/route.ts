import { requireDeploymentAccess } from '@/lib/deployment-access';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticatedUser, loadByokContext, serviceDb } from '@/lib/ai/server';
import { backendUrl, backendHeaders } from '@/lib/backend';
import { POST as generateImage } from '@/app/api/generate-image/route';

const briefSchema = z.object({
  subject: z.string().trim().min(2).max(120), prompt: z.string().trim().min(2).max(3000),
  grounding: z.string().max(12000).optional(), source: z.enum(['auto', 'reference']).default('auto'),
  quality: z.string().optional(), format: z.string().max(30).optional(), seed: z.number().optional(),
});

export async function POST(request: NextRequest) {
  const denied = requireDeploymentAccess(request);
  if (denied) return denied;
  let generating = false;
  try {
    const userId = await authenticatedUser(request);
    if (!userId) return NextResponse.json({ error: 'Sign in to add presentation images.' }, { status: 401 });
    const parsed = briefSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Provide a slide subject and a specific visual brief.' }, { status: 400 });
    const brief = parsed.data;
    const db = serviceDb();
    const { data: connections, error } = await db.from('provider_connections')
      .select('id,capability_usage').eq('user_id', userId).eq('enabled', true).eq('status', 'connected');
    if (error) throw new Error('Could not check connected image models.');
    const ids = (connections || []).filter(item => item.capability_usage?.image !== false).map(item => item.id);
    const { data: models, error: modelError } = ids.length ? await db.from('provider_models')
      .select('id,capabilities').in('connection_id', ids).eq('enabled', true) : { data: [], error: null };
    if (modelError) throw new Error('Could not check connected image models.');
    const hasImageModel = (models || []).some(item => item.capabilities?.imageGeneration === true);

    if (brief.source === 'reference' || !hasImageModel) {
      const response = await fetch(backendUrl('/api/agent/media'), { method: 'POST',
        headers: backendHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ subjects: [brief.subject], grounding: brief.grounding || brief.subject,
          byok: await loadByokContext(userId) }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(40_000)]),
      });
      if (!response.ok) throw new Error('Reference image search is unavailable.');
      const payload = await response.json();
      const candidate = Array.isArray(payload.images) ? payload.images.find((item: { verified?: boolean; url?: string }) => item.verified === true && /^https:\/\//i.test(item.url || '')) : undefined;
      if (!candidate) return NextResponse.json({ generated: false, omitted: true, modelUsed: 'Web reference', notice: 'No relevant verified reference image was available for this slide.' });
      return NextResponse.json({ url: candidate.url, generated: false, modelUsed: 'Web reference', sourceUrl: candidate.sourceUrl,
        caption: candidate.title, notice: !hasImageModel ? 'No image model connected; using a verified web reference where needed.' : undefined });
    }

    const headers = new Headers({ 'Content-Type': 'application/json', 'x-void-user-token': request.headers.get('x-void-user-token') || '' });
    if (request.headers.has('authorization')) headers.set('authorization', request.headers.get('authorization')!);
    generating = true;
    const response = await generateImage(new Request(new URL('/api/generate-image', request.url), { method: 'POST', headers,
      body: JSON.stringify({ prompt: `${brief.prompt}\nCreate only a supporting illustration. No slide mockup, text, labels, charts or watermark.`,
        size: brief.format === 'presentation' ? '1536x1024' : '1024x1536', connectedOnly: true }), signal: request.signal }));
    const payload = await response.json();
    if (!response.ok) return NextResponse.json({ error: 'This image could not be generated because the connected image model encountered a problem. Please retry or check the model API key and quota.', code: 'generation_failed' }, { status: response.status });
    if (typeof payload.url !== 'string' || !/^\/api\/generated-image\/[a-f0-9-]{36}\.(png|jpg|webp)$/i.test(payload.url) || typeof payload.modelUsed !== 'string') {
      throw new Error('The connected image model returned an invalid image.');
    }
    return NextResponse.json({ url: payload.url, modelUsed: payload.modelUsed, generated: true });
  } catch {
    return NextResponse.json({ error: generating
      ? 'This image could not be generated because the connected image model encountered a problem. Please retry or check the model API key and quota.'
      : 'The image could not be prepared. Please check your connected image model or reference-image service and retry.',
      code: generating ? 'generation_failed' : 'image_preparation_failed' }, { status: 503 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Use an authenticated POST to prepare a slide image.' }, { status: 405 });
}
