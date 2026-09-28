export type VoiceConfig = {
  mode: 'native' | 'modular'; nativeProvider: 'openai' | 'google'; nativeConnectionId: string; nativeModel: string; nativeVoice: string;
  brainModelId: string; sttProvider: 'browser' | 'deepgram' | 'groq' | 'openai'; sttConnectionId: string;
  ttsProvider: 'browser' | 'elevenlabs' | 'cartesia' | 'openai'; ttsConnectionId: string; ttsVoice: string;
};
export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
export const GEMINI_VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck', 'Leda', 'Orus', 'Zephyr'];
export const DEFAULT_VOICE_CONFIG: VoiceConfig = { mode: 'modular', nativeProvider: 'openai', nativeConnectionId: '', nativeModel: 'gpt-realtime-2.1', nativeVoice: 'marin', brainModelId: '', sttProvider: 'browser', sttConnectionId: '', ttsProvider: 'browser', ttsConnectionId: '', ttsVoice: '' };
export function parseVoiceConfig(value: unknown): VoiceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid voice settings.');
  const config = { ...DEFAULT_VOICE_CONFIG, ...value } as VoiceConfig;
  for (const [key, allowed] of Object.entries({ mode: ['native', 'modular'], nativeProvider: ['openai', 'google'], sttProvider: ['browser', 'deepgram', 'groq', 'openai'], ttsProvider: ['browser', 'elevenlabs', 'cartesia', 'openai'] })) {
    if (!allowed.includes(String(config[key as keyof VoiceConfig]))) throw new Error('Choose a supported voice provider and mode.');
  }
  for (const key of Object.keys(DEFAULT_VOICE_CONFIG) as Array<keyof VoiceConfig>) if (typeof config[key] !== 'string' || config[key].length > 200) throw new Error('Invalid voice setting.');
  return Object.fromEntries(Object.keys(DEFAULT_VOICE_CONFIG).map(key => [key, config[key as keyof VoiceConfig]])) as VoiceConfig;
}
