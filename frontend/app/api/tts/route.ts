import { requireDeploymentAccess } from '@/lib/deployment-access';
import { loadVoiceConfig, voiceError, voiceOwner, voiceKey, VoiceError, VOICE_HEADERS } from '@/lib/ai/voice-server';
import { speechLanguage } from '@void/shared/speech-language.mjs';
import { multilingualSpeechBody } from '@/lib/ai/speech-provider';
export async function GET(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try { const config = await loadVoiceConfig(await voiceOwner(request)); return Response.json({ provider: config.ttsProvider, defaultVoiceId: config.ttsVoice }, { headers: VOICE_HEADERS }); } catch (error) { return voiceError(error); }
}
export async function POST(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try {
    const userId = await voiceOwner(request), config = await loadVoiceConfig(userId);
    if (config.mode !== 'modular' || config.ttsProvider === 'browser') throw new VoiceError('The selected speaking voice runs in the browser.');
    const body = await request.json(), text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 5000) throw new VoiceError('Voice text must contain 1–5000 characters.');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(config.ttsVoice)) throw new VoiceError('Select a speaking voice in Voice Agent settings.');
    const key = await voiceKey(userId, config.ttsConnectionId, config.ttsProvider);
    const language = speechLanguage(text, typeof body.language === 'string' ? body.language : 'en');
    const url = config.ttsProvider === 'openai' ? 'https://api.openai.com/v1/audio/speech' : config.ttsProvider === 'cartesia' ? 'https://api.cartesia.ai/tts/bytes' : `https://api.elevenlabs.io/v1/text-to-speech/${config.ttsVoice}/stream?output_format=mp3_44100_128`;
    const payload = config.ttsProvider === 'openai' ? JSON.stringify({ model: 'gpt-4o-mini-tts', input: text, voice: config.ttsVoice, response_format: 'mp3', instructions: 'Speak naturally in the language of the text, including Hindi, regional languages and Hinglish. Use native pronunciation and preserve language mixing.' })
      : config.ttsProvider === 'cartesia' ? JSON.stringify({ model_id: 'sonic-3.6', transcript: text, voice: config.ttsVoice, language, output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 } })
      : multilingualSpeechBody(text, language, body.previousText);
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.ttsProvider === 'elevenlabs' ? { 'xi-api-key': key } : { Authorization: `Bearer ${key}` }), ...(config.ttsProvider === 'cartesia' ? { 'Cartesia-Version': '2026-08-14' } : {}) }, body: payload, signal: AbortSignal.any([request.signal, AbortSignal.timeout(40000)]), cache: 'no-store', redirect: 'error' });
    if (!response.ok || !response.body) throw new VoiceError(`Your ${config.ttsProvider} speech request failed (${response.status}). Check its key and quota in Voice Agent settings.`, 502);
    return new Response(response.body, { headers: { ...VOICE_HEADERS, 'Content-Type': 'audio/mpeg', 'X-Accel-Buffering': 'no' } });
  } catch (error) { return voiceError(error); }
}
