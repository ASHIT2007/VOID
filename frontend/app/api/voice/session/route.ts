import { requireDeploymentAccess } from '@/lib/deployment-access';
import { loadVoiceConfig, validateVoiceConfig, voiceError, voiceOwner, voiceKey, providerJson, VOICE_HEADERS, VOICE_INSTRUCTIONS } from '@/lib/ai/voice-server';
import { createHash } from 'node:crypto';
export async function POST(request: Request) {
  const denied = requireDeploymentAccess(request); if (denied) return denied;
  try {
    const userId = await voiceOwner(request), config = await loadVoiceConfig(userId);
    await validateVoiceConfig(userId, config);
    if (config.mode === 'modular') return Response.json({ config }, { headers: VOICE_HEADERS });
    const key = await voiceKey(userId, config.nativeConnectionId, config.nativeProvider);
    if (config.nativeProvider === 'openai') {
      const session = { type: 'realtime', model: config.nativeModel, instructions: VOICE_INSTRUCTIONS,
        audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad', silence_duration_ms: 300, prefix_padding_ms: 300, create_response: true, interrupt_response: true } }, output: { voice: config.nativeVoice } } };
      const token = await providerJson('https://api.openai.com/v1/realtime/client_secrets', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'OpenAI-Safety-Identifier': createHash('sha256').update(userId).digest('hex') }, body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 60 }, session }) }, request.signal);
      if (typeof token.value !== 'string') throw new Error('No ephemeral credential');
      return Response.json({ config, token: token.value, expiresAt: token.expires_at }, { headers: VOICE_HEADERS });
    }
    const liveConfig = { responseModalities: ['AUDIO'], inputAudioTranscription: {}, outputAudioTranscription: {}, systemInstruction: { parts: [{ text: VOICE_INSTRUCTIONS }] }, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.nativeVoice } } } };
    const token = await providerJson('https://generativelanguage.googleapis.com/v1beta/auth_tokens', { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ uses: 1, newSessionExpireTime: new Date(Date.now() + 60000).toISOString(), expireTime: new Date(Date.now() + 30 * 60000).toISOString(), liveConnectConstraints: { model: `models/${config.nativeModel}`, config: liveConfig } }) }, request.signal);
    if (typeof token.name !== 'string') throw new Error('No ephemeral credential');
    return Response.json({ config, token: token.name, liveConfig }, { headers: VOICE_HEADERS });
  } catch (error) { return voiceError(error); }
}
