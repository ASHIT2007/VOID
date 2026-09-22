import { describe, it, expect, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { inferLanguageCode } from '../../routes/tts.js';

async function post(app: Express, body: unknown) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const res = await fetch(`http://127.0.0.1:${addr.port}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data };
}

describe('POST /api/tts', () => {
  let app: Express;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.DEEPGRAM_API_KEY;
    initDb(':memory:');
    app = createApp();
  });

  it('rejects requests without text', async () => {
    const { status, body } = await post(app, {});
    expect(status).toBe(400);
    expect(body.error.message).toContain('Missing "text"');
  });

  it('reports missing TTS provider configuration', async () => {
    const { status, body } = await post(app, { text: 'hello' });
    expect(status).toBe(500);
    expect(body.error.message).toContain('No TTS provider configured');
  });
});

describe('TTS language routing', () => {
  it('distinguishes Hindi, Marathi, Gujarati, and Tamil scripts', () => {
    expect(inferLanguageCode('यह एक हिंदी वाक्य है')).toBe('hi');
    expect(inferLanguageCode('हे एक मराठी वाक्य आहे')).toBe('mr');
    expect(inferLanguageCode('આ એક ગુજરાતી વાક્ય છે')).toBe('gu');
    expect(inferLanguageCode('இது ஒரு தமிழ் வாக்கியம்')).toBe('ta');
  });
});
