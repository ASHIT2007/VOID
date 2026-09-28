import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isPublicAddress } from '@void/shared/safe-fetch.mjs';
import { safeCustomRequest } from './safe-request';
import { ADMIN_EMAIL } from '@/lib/plans';
import { readExecutionConfig } from './execution-settings';
import type { ExecutionConfig } from '@void/shared/execution-config.mjs';

export type ProviderId = 'openai' | 'anthropic' | 'google' | 'groq' | 'mistral' | 'openrouter' | 'elevenlabs' | 'deepgram' | 'cartesia' | 'custom';
export type TaskCapability = 'chat' | 'tools' | 'image' | 'imageEditing' | 'voice';
export type RoutingMode = 'AUTO' | 'FAST' | 'DEEP' | 'CREATIVE' | 'EFFICIENT' | 'MANUAL';
export type ModelCapabilities = {
  text: boolean; vision: boolean; reasoning: boolean; toolCalling: boolean;
  structuredOutput: boolean; streaming: boolean; imageGeneration: boolean; imageEditing: boolean;
  voice?: boolean;
};
export const PROVIDERS: Record<Exclude<ProviderId, 'custom'>, { name: string; url: string }> = {
  openai: { name: 'OpenAI', url: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic', url: 'https://api.anthropic.com/v1' },
  google: { name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta' },
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1' },
  mistral: { name: 'Mistral', url: 'https://api.mistral.ai/v1' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  elevenlabs: { name: 'ElevenLabs', url: 'https://api.elevenlabs.io/v2' },
  deepgram: { name: 'Deepgram', url: 'https://api.deepgram.com/v1' },
  cartesia: { name: 'Cartesia', url: 'https://api.cartesia.ai' },
};

export const PROVIDER_CAPABILITIES: Record<ProviderId, readonly TaskCapability[]> = {
  openai: ['chat', 'tools', 'image', 'imageEditing', 'voice'],
  anthropic: ['chat', 'tools'], google: ['chat', 'tools', 'image', 'imageEditing', 'voice'],
  groq: ['chat', 'tools', 'voice'], mistral: ['chat', 'tools'],
  openrouter: ['chat', 'tools'], elevenlabs: ['voice'], deepgram: ['voice'], cartesia: ['voice'], custom: ['chat', 'tools'],
};

export async function isAdminUser(userId: string): Promise<boolean> {
  const { data, error } = await serviceDb().auth.admin.getUserById(userId);
  if (error || !data.user) return false;
  return data.user.app_metadata?.role === 'admin' ||
    (process.env.VOID_ADMIN_USER_IDS || '').split(',').map(id => id.trim()).includes(userId) ||
    Boolean(data.user.email_confirmed_at && data.user.email?.trim().toLowerCase() === ADMIN_EMAIL);
}

let dbClient: SupabaseClient | undefined;
export function serviceDb(): SupabaseClient {
  if (!dbClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('BYOK database is not configured');
    dbClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return dbClient;
}

export function providerStorageError(error?: { code?: string } | null): string {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return 'AI provider storage is not configured. Set SUPABASE_SERVICE_ROLE_KEY in frontend/.env.local and restart VOID.';
  }
  if (error?.code === 'PGRST205' || error?.code === '42P01') {
    return 'AI provider tables are missing. Apply backend/supabase/migrations/20260924000000_byok.sql to your Supabase project.';
  }
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    return 'AI provider orchestration columns are missing. Apply backend/supabase/migrations/20260924010000_provider_orchestration.sql to your Supabase project.';
  }
  return 'AI provider storage is unavailable. Check the Supabase connection and BYOK migration.';
}

export async function authenticatedUser(request: Request): Promise<string | null> {
  const token = request.headers.get('x-void-user-token');
  if (!token) return null;
  const { data, error } = await serviceDb().auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}

function encryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error('ENCRYPTION_KEY must be 64 hex characters for BYOK');
  return Buffer.from(key, 'hex');
}

export function sealKey(raw: string): { encrypted_api_key: string; key_iv: string; key_auth_tag: string; key_fingerprint: string; masked_key: string } {
  const key = encryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const fingerprint = createHmac('sha256', key).update(raw).digest('hex').slice(0, 24);
  return { encrypted_api_key: encrypted.toString('hex'), key_iv: iv.toString('hex'), key_auth_tag: cipher.getAuthTag().toString('hex'),
    key_fingerprint: fingerprint, masked_key: raw.length > 8 ? `${raw.slice(0, 3)}••••${raw.slice(-4)}` : `••••${raw.slice(-4)}` };
}

export function openKey(row: { encrypted_api_key: string; key_iv: string; key_auth_tag: string }): string {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(row.key_iv, 'hex'));
  decipher.setAuthTag(Buffer.from(row.key_auth_tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(row.encrypted_api_key, 'hex')), decipher.final()]).toString('utf8');
}

export function safeBaseUrl(raw: string): string {
  let cleaned = raw.trim().replace(/\/chat\/completions\/?$/i, '').replace(/\/+$/, '');
  const url = new URL(cleaned);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !host.includes('.')
    || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':') || /(?:^|\.)(?:internal|test)$/.test(host)) {
    throw new Error('Custom providers need a public HTTPS base URL');
  }
  return url.toString().replace(/\/$/, '');
}

export const NON_CHAT_MODEL_PATTERN = /(?:^|[\/_-])(?:embed|embedding|rerank|moderation|guard|nemoguard|safety|whisper|tts|stt|asr|transcri|canary|calibration|ising|detector|deplot|parse|reward|evaluator|classifier|clip|ocr)(?:[\/_-]|$)|(?:bge|e5|gte)-/i;

export function capabilitiesFor(provider: ProviderId, modelId: string, metadata?: Record<string, unknown>): ModelCapabilities {
  const id = modelId.toLowerCase();
  const image = provider === 'openai' && /^(?:gpt-image|dall-e)/.test(id)
    || provider === 'google' && /^gemini.*-image(?:-|$)/.test(id);
  const isNonChat = NON_CHAT_MODEL_PATTERN.test(id);
  const text = !image && !isNonChat;
  const vision = text && (provider === 'google' && /gemini/.test(id)
    || provider === 'anthropic' && /claude-(?:3|4)/.test(id)
    || provider === 'openai' && /gpt-(?:4o|4\.1|5)|^o[134]/.test(id)
    || provider === 'groq' && /vision|scout/.test(id)
    || provider === 'openrouter' && (metadata?.architecture as { input_modalities?: string[] } | undefined)?.input_modalities?.includes('image') === true);
  const tools = text && (provider === 'openai' && /(?:^|\/)gpt-|^o[134]/.test(id)
    || provider === 'anthropic' && /claude/.test(id)
    || provider === 'google' && /gemini/.test(id)
    || provider === 'groq' && /llama|qwen|gpt-oss|compound/.test(id)
    || provider === 'mistral' && /mistral|magistral|codestral|devstral|ministral/.test(id)
    || provider === 'openrouter' && Array.isArray(metadata?.supported_parameters) && metadata.supported_parameters.includes('tools')
    || provider === 'custom' && (metadata?.toolCalling === true || /kimi|moonshot|qwen|llama|deepseek/.test(id)));
  return { text, vision: Boolean(vision), reasoning: text && /(?:reason|thinking|^o[134]|sonnet|opus|pro|magistral|kimi|deepseek-r1)/.test(id),
    toolCalling: Boolean(tools), structuredOutput: text && (provider === 'openai' || provider === 'google' || provider === 'anthropic'
      || provider === 'openrouter' && Array.isArray(metadata?.supported_parameters) && metadata.supported_parameters.includes('response_format')),
    streaming: text,
    imageGeneration: image, imageEditing: image && !/dall-e/.test(id) };
}

export interface DiscoveredModel { modelId: string; displayName: string; capabilities: ModelCapabilities; contextWindow: number | null }

export async function discoverModels(provider: ProviderId, apiKey: string, customUrl?: string, customModel?: string): Promise<DiscoveredModel[]> {
  if (provider === 'deepgram' || provider === 'cartesia') {
    const response = await fetch(provider === 'deepgram' ? 'https://api.deepgram.com/v1/auth/grant' : 'https://api.cartesia.ai/voices?limit=100', {
      method: provider === 'deepgram' ? 'POST' : 'GET', headers: provider === 'deepgram' ? { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' } : { Authorization: `Bearer ${apiKey}`, 'Cartesia-Version': '2026-08-14' },
      body: provider === 'deepgram' ? JSON.stringify({ ttl_seconds: 30 }) : undefined, signal: AbortSignal.timeout(15000), cache: 'no-store', redirect: 'error',
    });
    if (!response.ok) throw new Error(`Voice provider validation failed (${response.status}). Check the key and its permissions.`);
    const data = await response.json();
    const items = provider === 'deepgram' ? [{ id: 'nova-3', name: 'Nova 3 multilingual transcription' }] : Array.isArray(data) ? data : data.data || [];
    if (!items.length) throw new Error('No voices are available for this key.');
    return items.slice(0, 100).map((item: { id: string; name?: string }) => ({ modelId: item.id, displayName: item.name || item.id, capabilities: { text: false, vision: false, reasoning: false, toolCalling: false, structuredOutput: false, streaming: true, imageGeneration: false, imageEditing: false, voice: true }, contextWindow: null }));
  }
  if (provider === 'elevenlabs') {
    const response = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', {
      headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000), cache: 'no-store', redirect: 'error',
    });
    if (response.status === 401 || response.status === 403) throw new Error('The provider rejected this API key');
    if (!response.ok) throw new Error(`ElevenLabs validation failed (${response.status})`);
    const data = await response.json() as { voices?: Array<{ voice_id?: string; name?: string }> };
    const voices = (data.voices || []).filter(voice => typeof voice.voice_id === 'string' && /^[A-Za-z0-9_-]{10,64}$/.test(voice.voice_id));
    return voices.slice(0, 100).map(voice => ({ modelId: voice.voice_id!, displayName: voice.name || voice.voice_id!,
      capabilities: { text: false, vision: false, reasoning: false, toolCalling: false, structuredOutput: false,
        streaming: false, imageGeneration: false, imageEditing: false, voice: true }, contextWindow: null }));
  }
  const base = provider === 'custom' ? safeBaseUrl(customUrl || '') : PROVIDERS[provider].url;
  if (provider === 'custom') {
    const addresses = await lookup(new URL(base).hostname, { all: true });
    if (!addresses.length || addresses.some(address => !isPublicAddress(address.address))) {
      throw new Error('Custom providers need a public HTTPS base URL');
    }
  }
  const url = `${base}/models`;
  const headers: Record<string, string> = provider === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : provider === 'google' ? { 'x-goog-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` };
  if (provider === 'openrouter') {
    const auth = await fetch(`${base}/key`, { headers, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    if (!auth.ok) throw new Error(auth.status === 401 || auth.status === 403
      ? 'The provider rejected this API key' : 'Could not validate this OpenRouter key');
  }
  let response: Response;
  try { response = provider === 'custom' ? await safeCustomRequest(url, headers)
    : await fetch(url, { headers, signal: AbortSignal.timeout(15_000), cache: 'no-store', redirect: 'error' }); }
  catch { throw new Error('Could not reach the provider model catalog'); }
  if (response.status === 401 || response.status === 403) throw new Error('The provider rejected this API key');
  if (!response.ok && provider !== 'custom') throw new Error(`Provider model discovery failed (${response.status})`);
  if (!response.ok && provider === 'custom' && customModel) {
    const probe = await safeCustomRequest(`${base}/chat/completions`, { ...headers, 'Content-Type': 'application/json' },
      JSON.stringify({ model: customModel, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }));
    if (probe.status === 401 || probe.status === 403) throw new Error('The provider rejected this API key');
    if (!probe.ok) throw new Error('The custom model could not complete a compatibility test');
  }
  const data = response.ok ? await response.json() as { data?: Array<Record<string, unknown>>; models?: Array<Record<string, unknown>> } : {};
  const raw = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  const models = raw.slice(0, 200).map(item => {
    const modelId = String(item.id || item.name || '').replace(/^models\//, '');
    return { modelId, displayName: String(item.display_name || item.displayName || modelId),
      capabilities: capabilitiesFor(provider, modelId, item), contextWindow: typeof item.context_length === 'number' ? item.context_length
        : typeof item.inputTokenLimit === 'number' ? item.inputTokenLimit : null };
  }).filter(model => model.modelId && (model.capabilities.text || model.capabilities.imageGeneration));

  if (provider === 'custom' && customModel) {
    const target = customModel.trim().toLowerCase();
    const existing = models.find(m => {
      const id = m.modelId.toLowerCase();
      return id === target || id.endsWith('/' + target) || id.includes(target);
    });
    if (existing) {
      existing.capabilities.toolCalling = existing.capabilities.toolCalling || /kimi|moonshot|qwen|llama|deepseek/.test(existing.modelId.toLowerCase());
    } else {
      models.unshift({ modelId: customModel, displayName: customModel,
        capabilities: capabilitiesFor('custom', customModel), contextWindow: null });
    }
  }
  if (!models.length) throw new Error('No models were discovered for this key');
  return models;
}

export function apiError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/rejected this API key|No models|public HTTPS|AI provider (?:storage|tables)/.test(message)) return message;
  return 'Provider connection failed. Check the key and endpoint, then try again.';
}

export async function loadByokContext(userId: string, options: { includeManaged?: boolean } = {}): Promise<{ userId: string; mode: RoutingMode; manualModelId?: string; preferredModelId?: string; fallbackEnabled: boolean; execution?: ExecutionConfig; models: Array<Record<string, unknown>> }> {
  const db = serviceDb();
  const connectionResult = await db.from('provider_connections')
    .select('id,provider_id,encrypted_api_key,key_iv,key_auth_tag,base_url,enabled,capability_usage')
    .eq('user_id', userId).eq('enabled', true).eq('status', 'connected');
  let connections = connectionResult.data as Array<{ id: string; provider_id: string; encrypted_api_key: string;
    key_iv: string; key_auth_tag: string; base_url: string | null; enabled: boolean;
    capability_usage?: Record<string, boolean> }> | null;
  let error = connectionResult.error;
  // Existing deployments may not have applied the orchestration migration yet.
  // Keep chat and voice turns on their previously connected BYOK models.
  if (connectionResult.error?.code === '42703' || connectionResult.error?.code === 'PGRST204') {
    const legacyResult = await db.from('provider_connections')
      .select('id,provider_id,encrypted_api_key,key_iv,key_auth_tag,base_url,enabled')
      .eq('user_id', userId).eq('enabled', true).eq('status', 'connected');
    connections = legacyResult.data;
    error = legacyResult.error;
  }
  if (error) throw new Error('Could not load your AI providers.');
  const ids = (connections || []).map(connection => connection.id);
  const { data: models, error: modelError } = ids.length ? await db.from('provider_models')
    .select('id,connection_id,provider_id,model_id,display_name,capabilities,context_window,enabled,priority')
    .in('connection_id', ids).eq('enabled', true) : { data: [], error: null };
  if (modelError) throw new Error('Could not load your models.');
  let preferenceResult = await db.from('routing_preferences').select('default_mode,preferred_model_id,fallback_enabled').eq('user_id', userId).maybeSingle();
  if (preferenceResult.error?.code === '42703' || preferenceResult.error?.code === 'PGRST204') {
    preferenceResult = await db.from('routing_preferences').select('default_mode,preferred_model_id').eq('user_id', userId).maybeSingle();
  }
  const { data: preferences } = preferenceResult;
  const connectionMap = new Map((connections || []).map(connection => [connection.id, connection]));
  const userModels = (models || []).flatMap(model => {
    if (NON_CHAT_MODEL_PATTERN.test(model.model_id)) return [];
    const connection = connectionMap.get(model.connection_id);
    return connection && connection.capability_usage?.chat !== false ? [{ id: model.id, connectionId: connection.id, providerId: model.provider_id,
      modelId: model.model_id, displayName: model.display_name, baseUrl: connection.base_url,
      encryptedKey: connection.encrypted_api_key, iv: connection.key_iv, authTag: connection.key_auth_tag,
      toolsEnabled: connection.capability_usage?.tools !== false,
      capabilities: { ...model.capabilities, toolCalling: model.capabilities?.toolCalling && connection.capability_usage?.tools !== false },
      contextWindow: model.context_window, enabled: model.enabled, priority: model.priority }] : [];
  });
  const managed: Array<Record<string, unknown>> = [];
  if (options.includeManaged !== false && await isAdminUser(userId) && process.env.GROQ_API_KEY
    && /^[0-9a-f]{64}$/i.test(process.env.ENCRYPTION_KEY || '')) {
    const credential = sealKey(process.env.GROQ_API_KEY);
    const primary = process.env.VOID_MANAGED_GROQ_MODEL || 'openai/gpt-oss-120b';
    const backup = process.env.VOID_MANAGED_GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b';
    for (const [index, modelId] of [...new Set([primary, backup].filter(Boolean))].entries()) {
      managed.push({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        connectionId: '00000000-0000-4000-8000-000000000001', providerId: 'groq', modelId,
        displayName: index ? 'VOID managed backup' : 'VOID managed',
        baseUrl: null, encryptedKey: credential.encrypted_api_key, iv: credential.key_iv, authTag: credential.key_auth_tag,
        capabilities: { text: true, vision: false, reasoning: false, toolCalling: true, structuredOutput: false, streaming: true },
        contextWindow: 32768, enabled: true, priority: -100 - index * 10 });
    }
  }
  const eligible = userModels.filter(model => model.capabilities.text && model.capabilities.streaming).sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id));
  const execution = eligible.length ? await readExecutionConfig(userId, eligible.map(model => model.id), preferences?.preferred_model_id) : undefined;
  return { userId, mode: (preferences?.default_mode || 'AUTO') as RoutingMode,
    manualModelId: execution?.primaryModelId || preferences?.preferred_model_id || undefined,
    preferredModelId: execution?.primaryModelId || preferences?.preferred_model_id || undefined,
    fallbackEnabled: execution ? execution.fallbackModelIds.length > 0 : preferences?.fallback_enabled !== false,
    ...(execution ? { execution } : {}),
    models: [...userModels, ...managed] };
}
