import 'server-only';
import { authenticatedUser, loadByokContext, openKey, serviceDb } from './server';
import { DEFAULT_VOICE_CONFIG, GEMINI_VOICES, OPENAI_VOICES, parseVoiceConfig, type VoiceConfig } from '../voice-config';
export const VOICE_HEADERS = { 'Cache-Control': 'no-store' };
export const VOICE_INSTRUCTIONS = 'You are VOID, a helpful voice assistant. Respond naturally and concisely in the language the user speaks. Automatically follow language changes and code-switching, including Hindi, regional Indian languages and Hinglish. Use native pronunciation and a natural regional accent; do not force an American accent. Never claim to have used tools, accessed files or completed external actions unless an actual tool result confirms it.';
export class VoiceError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function voiceError(error: unknown) { return Response.json({ error: error instanceof VoiceError ? error.message : 'The selected voice service is unavailable. Check its connection in AI & Providers → Voice Agent.' }, { status: error instanceof VoiceError ? error.status : 502, headers: VOICE_HEADERS }); }
export async function voiceOwner(request: Request) { const userId = await authenticatedUser(request); if (!userId) throw new VoiceError('Sign in to use your voice settings.', 401); return userId; }
export async function loadVoiceConfig(userId: string): Promise<VoiceConfig> {
  const { data, error } = await serviceDb().from('voice_preferences').select('config').eq('user_id', userId).maybeSingle();
  if (error) throw new VoiceError('Voice settings storage is unavailable. Apply the 20260928000000_voice_agent.sql migration.', 503);
  return parseVoiceConfig(data?.config || DEFAULT_VOICE_CONFIG);
}
export async function voiceConnection(userId: string, id: string, provider: string) {
  if (!id) throw new VoiceError(`Connect and select your ${provider} key in AI & Providers → Voice Agent.`, 422);
  const { data, error } = await serviceDb().from('provider_connections').select('id,provider_id,encrypted_api_key,key_iv,key_auth_tag,capability_usage')
    .eq('id', id).eq('user_id', userId).eq('provider_id', provider).eq('enabled', true).eq('status', 'connected').single();
  if (error || !data || data.capability_usage?.voice === false) throw new VoiceError(`Your selected ${provider} voice connection is unavailable. Choose an enabled connection in Voice Agent settings.`, 422);
  return data;
}
export async function validateVoiceConfig(userId: string, config: VoiceConfig) {
  if (config.mode === 'native') {
    await voiceConnection(userId, config.nativeConnectionId, config.nativeProvider);
    if (!(config.nativeProvider === 'openai' ? OPENAI_VOICES : GEMINI_VOICES).includes(config.nativeVoice)) throw new VoiceError('Choose a supported realtime voice.');
    if (!(config.nativeProvider === 'openai' ? /^gpt-realtime(?:-[a-z0-9.]+)*$/ : /^gemini-[a-z0-9.-]*live[a-z0-9.-]*$/).test(config.nativeModel)) throw new VoiceError('Choose a realtime audio model for this provider.');
  } else {
    const context = await loadByokContext(userId, { includeManaged: false });
    if (!config.brainModelId || !context.models.some(model => model.id === config.brainModelId && model.enabled && (model.capabilities as { text?: boolean; streaming?: boolean }).text && (model.capabilities as { streaming?: boolean }).streaming)) throw new VoiceError('Select an enabled connected text model as the voice brain.', 422);
    if (config.sttProvider !== 'browser') await voiceConnection(userId, config.sttConnectionId, config.sttProvider);
    if (config.ttsProvider !== 'browser') {
      await voiceConnection(userId, config.ttsConnectionId, config.ttsProvider);
      if (!config.ttsVoice || !/^[a-zA-Z0-9_-]{1,100}$/.test(config.ttsVoice)) throw new VoiceError('Select a speaking voice.');
      if (config.ttsProvider === 'openai' && ![...OPENAI_VOICES, 'fable', 'nova', 'onyx'].includes(config.ttsVoice)) throw new VoiceError('Choose an OpenAI TTS voice.');
    }
  }
}
export async function providerJson(url: string, init: RequestInit, signal: AbortSignal) {
  const response = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new VoiceError(`The selected voice provider rejected the request (${response.status}). Check your key, access and quota.`, 502);
  return response.json();
}
export async function voiceKey(userId: string, id: string, provider: string) { return openKey(await voiceConnection(userId, id, provider)); }
