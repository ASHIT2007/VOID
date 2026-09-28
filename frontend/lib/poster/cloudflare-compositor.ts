import sharp from 'sharp';
import { posterTitleLines, type PosterImageSize } from '../poster-generation';

const escapeXml = (value: string) => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);

/** Server-only composition keeps SDXL artwork and exact, legible title separate. */
export async function composeCloudflarePoster(bytes: Buffer, prompt: string, size: PosterImageSize): Promise<Buffer> {
  const [width, height] = size.split('x').map(Number);
  const lines = posterTitleLines(prompt);
  const longest = Math.max(...lines.map(line => line.length), 1);
  const fontSize = Math.min(width * 0.078, width * 0.82 / (longest * 0.64));
  const lineHeight = fontSize * 1.14;
  const bottom = height * 0.075;
  const title = lines.map((line, index) => `<text x="${width * 0.075}" y="${height - bottom - (lines.length - 1 - index) * lineHeight}" font-family="Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="#fff">${escapeXml(line)}</text>`).join('');
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.94"/></linearGradient></defs><rect x="0" y="${height * 0.5}" width="${width}" height="${height * 0.5}" fill="url(#shade)"/>${title}</svg>`;
  return sharp(bytes, { limitInputPixels: 24_000_000 }).resize(width, height, { fit: 'cover', position: 'attention' })
    .composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 94 }).toBuffer();
}
