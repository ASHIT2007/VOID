import { requireDeploymentAccess } from '@/lib/deployment-access';
import { loadVoiceConfig, voiceError, voiceOwner, voiceKey, providerJson, VoiceError, VOICE_HEADERS } from '@/lib/ai/voice-server';
export async function GET(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try {
    const userId = await voiceOwner(request), config = await loadVoiceConfig(userId);
    if (config.mode !== 'modular' || config.sttProvider !== 'deepgram') throw new VoiceError('Select Deepgram transcription in Voice Agent settings.');
    const key = await voiceKey(userId, config.sttConnectionId, 'deepgram');
    const token = await providerJson('https://api.deepgram.com/v1/auth/grant', { method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl_seconds: 60 }) }, request.signal);
    if (!token.access_token) throw new Error('Missing token');
    return Response.json({ token: token.access_token, expiresIn: token.expires_in || 60 }, { headers: VOICE_HEADERS });
  } catch (error) { return voiceError(error); }
}
export async function POST(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try {
    const userId = await voiceOwner(request), config = await loadVoiceConfig(userId);
    if (config.mode !== 'modular' || !['groq', 'openai'].includes(config.sttProvider)) throw new VoiceError('Select Groq Whisper or OpenAI Whisper in Voice Agent settings.');
    const incoming = await request.formData(), file = incoming.get('audio');
    if (!(file instanceof File) || !file.size || file.size > 25000000) throw new VoiceError('Supply an audio recording smaller than 25 MB.');
    const key = await voiceKey(userId, config.sttConnectionId, config.sttProvider);
    const form = new FormData(); form.set('file', file); form.set('model', config.sttProvider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1'); form.set('response_format', 'json');
    // Omit language so multilingual speech and code switching are detected.
    const data = await providerJson(config.sttProvider === 'groq' ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form }, request.signal);
    return Response.json({ text: typeof data.text === 'string' ? data.text : '' }, { headers: VOICE_HEADERS });
  } catch (error) { return voiceError(error); }
}
