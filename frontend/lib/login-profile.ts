import md5 from 'md5';

const STORAGE_KEY = 'void:login-profile:v1';

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeAvatar(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2_000_000 && (
    /^https:\/\//i.test(value)
    || /^\/(?!\/)/.test(value)
    || /^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(value)
  );
}

/** Only call with profile data belonging to a successfully authenticated user. */
export function rememberLoginProfile(email: string, avatarUrl: string | null): void {
  const normalized = normalizeLoginEmail(email);
  if (typeof window === 'undefined' || !validEmail(normalized)) return;
  try {
    // Keep only the most recent account's photo; never store credentials here.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      emailHash: md5(normalized),
      avatarUrl: safeAvatar(avatarUrl) ? avatarUrl : null,
    }));
  } catch {
    // Disabled storage or a full quota must not prevent authentication.
  }
}

export function readLoginAvatar(email: string): string | null {
  const normalized = normalizeLoginEmail(email);
  if (typeof window === 'undefined' || !validEmail(normalized)) return null;
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return null;
    const profile = stored as Record<string, unknown>;
    return profile.emailHash === md5(normalized) && safeAvatar(profile.avatarUrl)
      ? profile.avatarUrl
      : null;
  } catch {
    return null;
  }
}
