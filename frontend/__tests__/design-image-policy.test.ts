import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { attachGeneratedImage, attachImageFailure, imageRequestFor, imageRequestKey, plannedImageRequests } from '@/lib/design/design-image-client';
import type { PresentationData } from '@/types/presentation';

function deck(): PresentationData {
  return { id: 'visual-policy', title: 'Snow leopards', theme: 'academic-clean', format: 'presentation',
    slides: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, slideNumber: i + 1, layout: 'image-feature',
      title: `Snow leopard ${i}`, imageSubject: 'Snow leopard', imagePrompt: `Snow leopard habitat ${i}`,
      visualRole: 'hero-image', content: { bodyText: 'Snow leopards live in mountains.' } })) };
}
describe('presentation image source and persistence policy', () => {
  it('favors generated illustrations for selected slots and never fills every slide', () => {
    const data = deck(); expect(plannedImageRequests(data)).toHaveLength(4);
    expect(plannedImageRequests(data).every(item => item.request.source === 'auto')).toBe(true);
    data.slides[1].visualRole = 'documentary-image';
    expect(imageRequestFor(data, data.slides[1])?.source).toBe('reference');
    data.slides[2].layout = 'diagram'; expect(imageRequestFor(data, data.slides[2])).toBeNull();
    data.hideImages = true; expect(plannedImageRequests(data)).toEqual([]);
  });
  it('persists a model failure, retains the visual brief and spends again only after explicit revision', () => {
    let data = deck(); const slot = plannedImageRequests(data)[0];
    data = attachImageFailure(data, slot.slideId, slot.key, 'Image could not be generated due to an image model problem.');
    expect(data.slides[0].imageGeneration).toMatchObject({ status: 'failed', message: expect.stringContaining('image model') });
    expect(data.slides[0].imagePrompt).toBeTruthy(); expect(data.slides[0].imageUrl).toBeUndefined();
    expect(plannedImageRequests(JSON.parse(JSON.stringify(data))).map(item => item.slideId)).not.toContain(slot.slideId);
    data.slides[0].imageGeneration = { revision: 1 };
    expect(plannedImageRequests(data).map(item => item.slideId)).toContain(slot.slideId);
  });
  it('retains provenance and rejects late results, duplicates and fabricated image references', () => {
    let data = deck(); const request = imageRequestFor(data, data.slides[0])!; const key = imageRequestKey(request);
    expect(attachGeneratedImage(data, 's0', 'stale', { url: 'https://images.example/snow.jpg', modelUsed: 'User model', generated: true })).toBe(data);
    data = attachGeneratedImage(data, 's0', key, { url: 'https://images.example/snow.jpg', modelUsed: 'Web reference', generated: false, sourceUrl: 'https://source.example/snow' });
    expect(data.slides[0].imageGeneration).toMatchObject({ status: 'completed', generated: false, sourceUrl: 'https://source.example/snow' });
    const second = imageRequestFor(data, data.slides[1])!;
    data = attachGeneratedImage(data, 's1', imageRequestKey(second), { url: data.slides[0].imageUrl, modelUsed: 'Web reference', generated: false });
    expect(data.slides[1].imageUrl).toBeUndefined(); expect(data.slides[1].imageGeneration?.status).toBe('omitted');
  });
  it('leaves unillustrated reference slots omitted rather than generating without a key', () => {
    const data = deck(), slot = plannedImageRequests(data)[0];
    const result = attachGeneratedImage(data, slot.slideId, slot.key, { generated: false, omitted: true, modelUsed: 'Web reference', notice: 'No relevant verified image.' });
    expect(result.slides[0].imageGeneration?.status).toBe('omitted'); expect(result.slides[0].imageUrl).toBeUndefined();
  });
});
