import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeLoginEmail, readLoginAvatar, rememberLoginProfile } from '../lib/login-profile';

describe('remembered login photo', () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }),
  };

  beforeEach(() => {
    entries.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    vi.stubGlobal('window', { localStorage: storage });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('recognizes the exact account despite whitespace or email casing', () => {
    rememberLoginProfile('  USER@example.com ', 'https://example.com/photo.jpg');
    expect(normalizeLoginEmail(' USER@EXAMPLE.com ')).toBe('user@example.com');
    expect(readLoginAvatar('USER@example.COM')).toBe('https://example.com/photo.jpg');
    expect(readLoginAvatar('other@example.com')).toBeNull();
    expect(readLoginAvatar('user@example')).toBeNull();
    expect(readLoginAvatar('')).toBeNull();
  });

  it('keeps only the last authenticated account and no raw email', () => {
    rememberLoginProfile('first@example.com', '/first.png');
    rememberLoginProfile('second@example.com', '/second.png');
    expect(readLoginAvatar('first@example.com')).toBeNull();
    expect(readLoginAvatar('second@example.com')).toBe('/second.png');
    expect(entries.size).toBe(1);
    expect([...entries.values()].join('')).not.toContain('second@example.com');
  });

  it('updates uploaded photos and clears a removed photo for the same account', () => {
    rememberLoginProfile('user@example.com', 'data:image/png;base64,aGVsbG8=');
    expect(readLoginAvatar('user@example.com')).toBe('data:image/png;base64,aGVsbG8=');
    rememberLoginProfile('user@example.com', null);
    expect(readLoginAvatar('user@example.com')).toBeNull();
  });

  it.each(['javascript:alert(1)', '//external.example/photo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,' + 'x'.repeat(2_000_000)])('ignores an unsafe or oversized image', (url) => {
    rememberLoginProfile('user@example.com', url);
    expect(readLoginAvatar('user@example.com')).toBeNull();
  });

  it('tolerates corrupted data, unavailable storage and server rendering', () => {
    rememberLoginProfile('user@example.com', '/photo.png');
    const key = [...entries.keys()][0];
    entries.set(key, '{broken');
    expect(readLoginAvatar('user@example.com')).toBeNull();
    entries.set(key, 'null');
    expect(readLoginAvatar('user@example.com')).toBeNull();
    storage.setItem.mockImplementationOnce(() => { throw new Error('Quota exceeded'); });
    expect(() => rememberLoginProfile('user@example.com', '/photo.png')).not.toThrow();
    storage.getItem.mockImplementationOnce(() => { throw new Error('Storage blocked'); });
    expect(readLoginAvatar('user@example.com')).toBeNull();
    vi.stubGlobal('window', undefined);
    expect(readLoginAvatar('user@example.com')).toBeNull();
    expect(() => rememberLoginProfile('user@example.com', '/photo.png')).not.toThrow();
  });
});
