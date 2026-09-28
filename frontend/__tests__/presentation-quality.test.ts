import { describe, it, expect } from 'vitest';
import type { PresentationData } from '@/types/presentation';
import { normalizePresentation } from '@/lib/design/visual-design-engine';
import { inspectPresentation } from '@/lib/design/presentation-quality';
import { buildAiPosterPrompt, buildCloudflarePosterPrompt, posterTitleLines } from '@/lib/poster-generation';
import { composeCloudflarePoster } from '@/lib/poster/cloudflare-compositor';
import sharp from 'sharp';

const deck = (): PresentationData => ({ id: 'test', title: 'A history of discovery', theme: 'academic-clean', format: 'presentation', slides: Array.from({ length: 6 }, (_, i) => ({
  id: `s${i}`, slideNumber: i + 1, layout: 'editorial', title: `Discovery ${i + 1}`, content: {
    bodyText: 'Researchers compare observations with predictions and revise their explanations when evidence changes. Repeated measurements help other teams evaluate the same claim.',
    bullets: ['Separate observed results from the proposed explanation.', 'Describe the uncertainty and the limits of the evidence.'],
  },
})) });

describe('presentation delivery', () => {
  it('preserves every authored slide and complete text during normalization', () => {
    const input = deck(); input.slides[2].content.bodyText = 'A complete sentence. '.repeat(20);
    const result = normalizePresentation(input);
    expect(result.slides.map(s => s.title)).toEqual(input.slides.map(s => s.title));
    expect(result.slides[2].content.bodyText).toBe(input.slides[2].content.bodyText.trim());
    expect(normalizePresentation(result)).toEqual(result);
  });
  it('rejects blank content pages and wrong requested counts before rendering', () => {
    const input = deck(); input.slides[3].content = {};
    const result = inspectPresentation(JSON.stringify(input), 'Make 9 slides');
    expect(result.data).toBeUndefined();
    expect(result.issues.join(' ')).toMatch(/exactly 9.*Slide 4/);
  });
  it('removes invented citations and renders actual reference URLs', () => {
    const input = deck(); input.slides[1].content.sources = ['https://example.org/evidence', 'https://invented.org/source', 'javascript:alert(1)'];
    input.slides[5] = { ...input.slides[5], layout: 'references', title: 'Sources', content: { bodyText: 'All images are fair use.' } };
    const result = inspectPresentation(JSON.stringify(input), '', ['https://example.org/evidence']);
    expect(result.data?.slides[5].content.sources).toEqual(['https://example.org/evidence']);
    expect(result.data?.slides[5].content.bodyText).toBeUndefined();
  });
  it('reports malformed model output without crashing', () => {
    expect(inspectPresentation('{ broken').data).toBeUndefined();
    expect(inspectPresentation(JSON.stringify({ slides: [null] })).data).toBeUndefined();
    const input = deck(); input.slides[2].content.timeline = [null] as never;
    expect(inspectPresentation(JSON.stringify(input)).issues.length).toBeGreaterThan(0);
  });
  it('requires content-backed specialized layouts', () => {
    const input = deck(); input.slides[2].layout = 'timeline';
    expect(inspectPresentation(JSON.stringify(input)).issues.join(' ')).toMatch(/3 complete events/);
  });
});

describe('Cloudflare poster composition', () => {
  it('uses a clean artwork prompt and exact title', () => {
    const prompt = buildAiPosterPrompt('now make a poster on life of Kakashi');
    expect(posterTitleLines(prompt).join(' ')).toBe('life of Kakashi');
    const art = buildCloudflarePosterPrompt(prompt, '1024x1536');
    expect(art).toContain('absolutely no text');
    expect(art).not.toContain('Display the exact short title');
  });
  it('produces a real image in the requested aspect ratio with XML-safe typography', async () => {
    const input = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#253243' } }).png().toBuffer();
    const output = await composeCloudflarePoster(input, 'poster on Art & <Science>', '1024x1536');
    const metadata = await sharp(output).metadata();
    expect([metadata.width, metadata.height, metadata.format]).toEqual([1024, 1536, 'jpeg']);
  });
});
