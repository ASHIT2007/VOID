import '../env.js';
import Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initEncryptionKey, decrypt } from '../lib/crypto.js';
import { getProvider } from '../providers/index.js';
import { prepareVisionImage } from '../agent/image-input.js';

const [platform, model, imagePath] = process.argv.slice(2);
if (!platform || !model || !imagePath) throw new Error('Usage: verify-vision-route <platform> <model> <image-path>');
const db = new Database(fileURLToPath(new URL('../../data/freeapi.db', import.meta.url)), { readonly: true });
initEncryptionKey(db);
const row = db.prepare('SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE platform = ? AND enabled = 1 LIMIT 1').get(platform) as { encrypted_key: string; iv: string; auth_tag: string } | undefined;
if (!row) throw new Error('No configured credential');
const image = await prepareVisionImage(await readFile(imagePath));
const provider = getProvider(platform as never);
if (!provider) throw new Error('Unknown provider');
try {
  const response = await provider.chatCompletion(decrypt(row.encrypted_key, row.iv, row.auth_tag), [{ role: 'user', content: [
    { type: 'text', text: 'Describe the car photo at the upper right of this screenshot in two sentences. Use only visible details.' },
    { type: 'image_url', image_url: { url: `data:${image.type};base64,${image.base64}` } },
  ] }], model, { max_tokens: 350, signal: AbortSignal.timeout(60_000) });
  console.log(JSON.stringify({ model, answer: response.choices[0]?.message.content }));
} catch (error) {
  console.log(JSON.stringify({ model, error: error instanceof Error ? error.message : 'Vision request failed' }));
  process.exitCode = 1;
} finally { db.close(); }
