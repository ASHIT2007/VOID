import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_STORED_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type StoredImageMime = keyof typeof MIME_EXTENSIONS;

function storageDirectory(): string {
  return path.resolve(process.cwd(), "..", "data", "generated-images");
}

export function detectStoredImageMime(bytes: Buffer): StoredImageMime | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function storeGeneratedImage(bytes: Buffer, mimeType?: string): Promise<{ id: string; mimeType: StoredImageMime }> {
  if (bytes.length === 0 || bytes.length > MAX_STORED_IMAGE_BYTES) throw new Error("Generated image has an invalid size");
  const detected = detectStoredImageMime(bytes);
  if (!detected || (mimeType && !mimeType.startsWith("image/"))) throw new Error("Generated image has an unsupported format");
  const directory = storageDirectory();
  await mkdir(directory, { recursive: true });
  const id = `${randomUUID()}.${MIME_EXTENSIONS[detected]}`;
  await writeFile(path.join(directory, id), bytes, { flag: "wx" });
  return { id, mimeType: detected };
}

export async function readGeneratedImage(id: string): Promise<{ bytes: Buffer; mimeType: StoredImageMime }> {
  if (!/^[a-f0-9-]{36}\.(?:png|jpg|webp)$/i.test(id)) throw new Error("Invalid generated image id");
  const bytes = await readFile(path.join(storageDirectory(), id));
  if (bytes.length === 0 || bytes.length > MAX_STORED_IMAGE_BYTES) throw new Error("Stored image has an invalid size");
  const mimeType = detectStoredImageMime(bytes);
  if (!mimeType) throw new Error("Stored image has an unsupported format");
  return { bytes, mimeType };
}
