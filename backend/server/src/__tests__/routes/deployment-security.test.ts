import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { consumeVoiceTicket, issueVoiceTicket } from '../../lib/voice-ticket.js';
import { requireDeploymentAccess } from '../../../../../frontend/lib/deployment-access';
import { isPublicAddress, safePublicFetch } from '@void/shared/safe-fetch.mjs';

const internal = 'test-internal-key-'.repeat(4);
const password = 'test-access-password-'.repeat(3);
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VOID_ACCESS_USER', 'operator');
  vi.stubEnv('VOID_ACCESS_PASSWORD', password);
  vi.stubEnv('VOID_INTERNAL_KEY', internal);
  vi.stubEnv('ENCRYPTION_KEY', '0'.repeat(64));
});
afterEach(() => vi.unstubAllEnvs());

describe('production deployment perimeter', () => {
  it('fails closed with missing configuration and refuses anonymous requests', () => {
    const req = new Request('https://void.example/api/chat');
    expect(requireDeploymentAccess(req)?.status).toBe(401);
    vi.stubEnv('VOID_ACCESS_PASSWORD', '');
    expect(requireDeploymentAccess(req)?.status).toBe(503);
  });
  it('accepts the operator and service credentials but rejects cross-site ambient credentials', () => {
    const authorization = `Basic ${Buffer.from(`operator:${password}`).toString('base64')}`;
    expect(requireDeploymentAccess(new Request('https://void.example/api/chat', { headers: { authorization } }))).toBeNull();
    expect(requireDeploymentAccess(new Request('https://void.example/api/chat', { headers: { authorization, 'sec-fetch-site': 'cross-site' } }))?.status).toBe(403);
    expect(requireDeploymentAccess(new Request('https://void.example/api/chat', { headers: { 'x-void-internal-key': internal } }))).toBeNull();
    expect(requireDeploymentAccess(new Request('https://void.example/', { headers: { 'x-void-internal-key': internal } }))?.status).toBe(401);
  });
  it('rejects every formerly public backend AI route before running its handler', async () => {
    initDb(':memory:');
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      for (const route of ['voice-chat', 'transcribe', 'tts', 'agent/chat', 'ai/generate', 'ai/health', 'ai/health/check', 'chat', 'attachments']) {
        expect((await fetch(`${base}/api/${route}`, { method: 'POST' })).status, route).toBe(401);
      }
      expect((await fetch(`${base}/api/ping`)).status).toBe(200);
      expect((await fetch(`${base}/api/attachments`, { method: 'POST', headers: { 'x-void-internal-key': internal } })).status).toBe(400);
      const setup = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: 'a-strong-password' }) };
      expect((await fetch(`${base}/api/auth/setup`, setup)).status).toBe(404);
      for (const route of ['keys', 'models', 'fallback', 'embeddings', 'analytics', 'health', 'settings']) {
        expect((await fetch(`${base}/api/${route}`)).status, route).toBe(404);
      }
      expect((await fetch(`${base}/v1/models`)).status).toBe(404);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

describe('voice socket tickets', () => {
  it('allows one connection only and expires in a minute', () => {
    expect(consumeVoiceTicket(null)).toBe(false);
    const ticket = issueVoiceTicket();
    expect(consumeVoiceTicket(ticket)).toBe(true);
    expect(consumeVoiceTicket(ticket)).toBe(false);
    const expired = issueVoiceTicket();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    expect(consumeVoiceTicket(expired)).toBe(false);
    clock.mockRestore();
  });
});

describe('public download boundaries', () => {
  it.each(['127.0.0.1', '10.1.1.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2002:7f00:1::', '0.0.0.0'])('rejects %s', address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it('accepts public addresses and rejects private downloads without connecting', async () => {
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    for (const url of ['http://127.1', 'http://2130706433', 'http://[::ffff:127.0.0.1]', 'file:///etc/passwd', 'https://user:password@example.com']) {
      await expect(safePublicFetch(url)).rejects.toThrow();
    }
  });
});
