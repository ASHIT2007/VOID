import sharp from 'sharp';

/** Normalize orientation and provider-compatible pixels once before failover. */
export async function prepareVisionImage(buffer: Buffer): Promise<{ type: string; base64: string }> {
  const image = await sharp(buffer, { limitInputPixels: 100_000_000, animated: false })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88 })
    .toBuffer();
  return { type: 'image/jpeg', base64: image.toString('base64') };
}
