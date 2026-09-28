import crypto from 'crypto';
import type Database from 'better-sqlite3';

const ALGORITHM = 'aes-256-gcm';

let cachedKey: Buffer | null = null;

/**
 * AES-256-GCM uses a 32-byte key, hex-encoded as 64 chars.
 * A typo'd ENCRYPTION_KEY (e.g. "abc") would historically fall through
 * the placeholder check, get truncated to 1.5 bytes, and only fail at
 * the first encrypt() call with a cryptic node:crypto error. Validate
 * the length up front and fail fast with an actionable message.
 */
const KEY_BYTES = 32;
const KEY_HEX_LEN = KEY_BYTES * 2;
const PLACEHOLDER_KEY = 'your-64-char-hex-key-here';

function parseHexKey(value: string, source: 'env' | 'db'): Buffer {
  if (value.length !== KEY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error(
      `Invalid ENCRYPTION_KEY (${source}): expected ${KEY_HEX_LEN} hex chars (32 bytes), got ${value.length} chars. ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return Buffer.from(value, 'hex');
}

// Production requires a stable server-only key for Supabase BYOK ciphertext.
// Historical tests can still pass a development database to persist a test key;
// the shipped agent server never creates that database.
function isDevFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function missingKeyError(): Error {
  return new Error(
    'ENCRYPTION_KEY is required in production for API key encryption. ' +
    `Set a ${KEY_HEX_LEN}-char hex key (generate one with: ` +
    `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"). ` +
    'Use the same key on the frontend and agent server.',
  );
}

/**
 * Initialize encryption key from env or an explicit local-dev fallback.
 * The optional database is only used by legacy development/test fixtures.
 */
export function initEncryptionKey(db?: Database.Database): void {
  // 1. Check env var
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey && envKey !== PLACEHOLDER_KEY) {
    cachedKey = parseHexKey(envKey, 'env');
    return;
  }

  if (!isDevFallbackAllowed()) {
    throw missingKeyError();
  }

  if (!db) {
    cachedKey = null;
    return;
  }

  // 2. Check DB for persisted key
  const row = db.prepare("SELECT value FROM settings WHERE key = 'encryption_key'").get() as { value: string } | undefined;
  if (row) {
    cachedKey = parseHexKey(row.value, 'db');
    console.warn('[crypto] No ENCRYPTION_KEY set — using auto-generated key from the local DB (dev only).');
    return;
  }

  // 3. Generate and persist
  cachedKey = crypto.randomBytes(KEY_BYTES);
  db.prepare("INSERT INTO settings (key, value) VALUES ('encryption_key', ?)").run(cachedKey.toString('hex'));
  console.warn('[crypto] No ENCRYPTION_KEY set — generated and persisted a local dev key. Set ENCRYPTION_KEY for production.');
}

function getEncryptionKey(): Buffer {
  if (!cachedKey && process.env.ENCRYPTION_KEY) {
    cachedKey = parseHexKey(process.env.ENCRYPTION_KEY, 'env');
  }
  if (!cachedKey) {
    throw new Error('ENCRYPTION_KEY is not configured. Set the same 64-character hex key on the frontend and agent server.');
  }
  return cachedKey;
}

export function encrypt(text: string): { encrypted: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

export function decrypt(encrypted: string, iv: string, authTag: string): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '****' + key.slice(-4);
  return key.slice(0, 4) + '...' + key.slice(-4);
}
