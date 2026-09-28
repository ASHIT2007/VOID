'use client';
import { useState } from 'react';
const brands = new Set(['openai', 'anthropic', 'google', 'groq', 'mistral', 'openrouter', 'elevenlabs', 'deepgram', 'cartesia', 'nvidia', 'cloudflare', 'deepseek', 'qwen', 'meta', 'cerebras', 'sambanova']);
export function providerBrand(providerId: string, name = '', baseUrl = '') {
  if (brands.has(providerId.toLowerCase())) return providerId.toLowerCase();
  const identity = `${name} ${baseUrl}`.toLowerCase();
  return [...brands].find(brand => identity.includes(brand)) || null;
}
export default function ProviderLogo({ providerId, name = '', baseUrl = '', size = 20 }: { providerId: string; name?: string; baseUrl?: string | null; size?: number }) {
  const brand = providerBrand(providerId, name, baseUrl || '');
  const [failed, setFailed] = useState<string | null>(null);
  if (!brand || failed === brand) return <span aria-label={`${name || providerId} provider`} className="inline-flex shrink-0 items-center justify-center font-semibold text-neutral-100" style={{ width: size, height: size, fontSize: Math.max(9, size * .4) }}>{(name || providerId).slice(0, 2).toUpperCase()}</span>;
  return <img src={`/provider-logos/${brand}.svg`} width={size} height={size} alt={`${brand} logo`} className="shrink-0 object-contain brightness-0 invert" onError={() => setFailed(brand)} />;
}
