import 'server-only';
import { createHash } from 'node:crypto';
import { selectNativeVoice, type NativeVoice } from '@void/shared/speech-language.mjs';

const catalogs = new Map<string, { expires: number; voices: NativeVoice[] }>();
const loading = new Map<string, Promise<{ expires: number; voices: NativeVoice[] }>>();
export async function nativeVoiceForKey(key: string, language: string, fallback: string, signal: AbortSignal, allowedIds?: string[]) {
  const cacheId = createHash('sha256').update(key).digest('hex');
  let catalog = catalogs.get(cacheId);
  if (!catalog || catalog.expires < Date.now()) {
    let pending = loading.get(cacheId);
    if (!pending) pending = (async () => {
      try {
        const response = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', {
          headers: { 'xi-api-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(8000), cache: 'no-store', redirect: 'error',
        });
        if (response.ok) {
          const data = await response.json() as { voices?: NativeVoice[] };
          const result = { expires: Date.now() + 300_000, voices: Array.isArray(data.voices) ? data.voices : [] };
          if (catalogs.size >= 64) catalogs.delete(catalogs.keys().next().value!);
          catalogs.set(cacheId, result);
          return result;
        }
      } catch { /* A restricted catalog key can still synthesize its saved voice. */ }
      const result = { expires: Date.now() + 15_000, voices: [] };
      if (catalogs.size >= 64) catalogs.delete(catalogs.keys().next().value!);
      catalogs.set(cacheId, result); return result;
    })();
    loading.set(cacheId, pending);
    try { catalog = await pending; } finally { loading.delete(cacheId); }
  }
  if (signal.aborted) throw new DOMException('Speech interrupted', 'AbortError');
  const voices = (catalog?.voices || []).filter(voice => !allowedIds || allowedIds.includes(voice.voice_id || ''));
  return selectNativeVoice(voices, language, fallback) || fallback;
}

export function multilingualSpeechBody(text: string, language: string, previousText?: unknown) {
  const flashLanguages = ['en', 'ja', 'zh', 'de', 'hi', 'fr', 'ko', 'pt', 'it', 'es', 'id', 'nl', 'tr', 'fil', 'pl', 'sv', 'bg', 'ro', 'ar', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'ru', 'hu', 'no', 'vi'];
  const model = flashLanguages.includes(language) ? 'eleven_flash_v2_5' : 'eleven_v3';
  return JSON.stringify({ text, model_id: model, language_code: language,
    ...(typeof previousText === 'string' && previousText.trim() ? { previous_text: previousText.slice(-1200) } : {}),
    voice_settings: { stability: 0.5, similarity_boost: 0.65, style: 0, use_speaker_boost: true },
  });
}
