import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';

export const ATTACHMENT_MAX_MB = Math.max(16, Number(process.env.ATTACHMENT_MAX_MB) || 256);
export const attachmentDirectory = fileURLToPath(new URL('../../data/attachments/', import.meta.url));
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function attachmentPath(id: string): string {
  if (!ID.test(id)) throw new Error('Invalid attachment ID');
  return path.join(attachmentDirectory, id);
}
export async function readStoredAttachment(url: string): Promise<Buffer | null> {
  const match = /^\/api\/attachments\/([a-f0-9-]+)$/.exec(url);
  if (!match) return null;
  const file = attachmentPath(match[1]);
  if ((await stat(file)).size > ATTACHMENT_MAX_MB * 1024 * 1024) throw new Error(`File exceeds the ${ATTACHMENT_MAX_MB} MB upload limit.`);
  return readFile(file);
}
