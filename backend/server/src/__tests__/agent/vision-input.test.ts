import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { estimateMessageTokens } from '../../lib/content.js';
import { prepareVisionImage } from '../../agent/image-input.js';

describe('vision inputs', () => {
  it('does not count base64 bytes as text tokens', () => {
    const tokens = (bytes: number) => estimateMessageTokens([{ role: 'user', content: [
      { type: 'text', text: 'Describe this image' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(bytes)}` } },
    ] }]);
    expect(tokens(3_000_000)).toBe(tokens(300));
    expect(tokens(3_000_000)).toBeLessThan(2000);
  });

  it('converts large images to provider-compatible pixels', async () => {
    const source = await sharp({ create: { width: 4096, height: 3072, channels: 4, background: '#123456' } }).png().toBuffer();
    const prepared = await prepareVisionImage(source);
    const metadata = await sharp(Buffer.from(prepared.base64, 'base64')).metadata();
    expect(prepared.type).toBe('image/jpeg');
    expect(metadata.width).toBe(2048);
    expect(metadata.height).toBe(1536);
  });
});
