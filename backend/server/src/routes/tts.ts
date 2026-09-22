import { Router } from 'express';
import type { Request, Response } from 'express';

export const ttsRouter = Router();

const DEFAULT_ELEVENLABS_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/;

type ElevenLabsVoice = { voice_id?: unknown; name?: unknown; category?: unknown };

const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}$/;

export function inferLanguageCode(text: string): string | undefined {
  if (/[\u0900-\u097F]/u.test(text)) {
    if (/(?:नेपाली|तपाईं|छैन|छन्|गर्नुहोस्|हुन्छ)/u.test(text)) return 'ne';
    return /(?:मराठी|आहे|आहेत|नाही|आणि|तुम्ही|करा|मध्ये|होते|होता)/u.test(text) ? 'mr' : 'hi';
  }
  if (/[\u0980-\u09FF]/u.test(text)) return /[ৰৱ]/u.test(text) ? 'as' : 'bn';
  if (/[\u0A00-\u0A7F]/u.test(text)) return 'pa';
  if (/[\u0A80-\u0AFF]/u.test(text)) return 'gu';
  if (/[\u0B00-\u0B7F]/u.test(text)) return 'or';
  if (/[\u0B80-\u0BFF]/u.test(text)) return 'ta';
  if (/[\u0C00-\u0C7F]/u.test(text)) return 'te';
  if (/[\u0C80-\u0CFF]/u.test(text)) return 'kn';
  if (/[\u0D00-\u0D7F]/u.test(text)) return 'ml';
  if (/[\u0D80-\u0DFF]/u.test(text)) return 'si';
  if (/[\u0600-\u06FF]/u.test(text)) return /[ٹڈڑںھہئے]/u.test(text) ? 'ur' : 'ar';
  if (/[\u3040-\u30FF]/u.test(text)) return 'ja';
  if (/[\uAC00-\uD7AF]/u.test(text)) return 'ko';
  if (/[\u4E00-\u9FFF]/u.test(text)) return 'zh';
  return undefined;
}

let cachedVoices: { expiresAt: number; voices: Array<{ id: string; name: string }> } | null = null;

async function pipeWebStream(stream: ReadableStream<Uint8Array>, res: Response): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

async function streamElevenLabs(text: string, previousText: string, voiceId: string, languageCode: string | undefined, res: Response, signal: AbortSignal): Promise<boolean> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return false;

  const configuredModel = process.env.ELEVENLABS_MODEL_ID;
  // Regional-language turns favor Eleven v3 quality and language fidelity.
  // English keeps the low-latency model for fast conversational responses.
  const modelId = configuredModel || (languageCode && languageCode !== 'en'
    ? process.env.ELEVENLABS_MULTILINGUAL_MODEL_ID || process.env.ELEVENLABS_EXTENDED_MODEL_ID || 'eleven_v3'
    : 'eleven_flash_v2_5');

  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${encodeURIComponent(outputFormat)}`, {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      ...(languageCode ? { language_code: languageCode } : {}),
      ...(previousText ? { previous_text: previousText } : {}),
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        ...(modelId === 'eleven_v3' ? {} : { speed: 1 }),
        use_speaker_boost: true,
      },
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    console.warn(`ElevenLabs TTS failed: ${response.status} ${await response.text()}`);
    return false;
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Voice-Text', encodeURIComponent(text));
  await pipeWebStream(response.body, res);
  return true;
}

async function streamDeepgram(text: string, res: Response, signal: AbortSignal): Promise<boolean> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return false;

  const model = process.env.DEEPGRAM_TTS_MODEL || 'aura-stella-en';
  const response = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!response.ok || !response.body) {
    console.warn(`Deepgram TTS failed: ${response.status} ${await response.text()}`);
    return false;
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Voice-Text', encodeURIComponent(text));
  await pipeWebStream(response.body, res);
  return true;
}

ttsRouter.get(['/', ''], async (_req: Request, res: Response) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const configuredDefaultVoiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID;
  if (!apiKey) {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ defaultVoiceId: configuredDefaultVoiceId, voices: [{ id: configuredDefaultVoiceId, name: 'Default' }] });
    return;
  }

  try {
    if (!cachedVoices || cachedVoices.expiresAt < Date.now()) {
      const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`ElevenLabs voices returned ${response.status}`);
      const data = await response.json() as { voices?: ElevenLabsVoice[] };
      const voices = (data.voices || [])
        .filter((voice): voice is ElevenLabsVoice & { voice_id: string; name: string } =>
          typeof voice.voice_id === 'string' && typeof voice.name === 'string' && VOICE_ID_PATTERN.test(voice.voice_id))
        .map((voice) => ({ id: voice.voice_id, name: voice.name.trim().slice(0, 36) }))
        .slice(0, 30);
      cachedVoices = { expiresAt: Date.now() + 60 * 60 * 1000, voices };
    }
    const defaultVoiceId = cachedVoices.voices.some((voice) => voice.id === configuredDefaultVoiceId)
      ? configuredDefaultVoiceId
      : cachedVoices.voices[0]?.id || DEFAULT_ELEVENLABS_VOICE_ID;
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.json({ defaultVoiceId, voices: cachedVoices.voices.length ? cachedVoices.voices : [{ id: defaultVoiceId, name: 'Default' }] });
  } catch (error) {
    console.warn('Unable to load ElevenLabs voices:', error);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ defaultVoiceId: DEFAULT_ELEVENLABS_VOICE_ID, voices: [{ id: DEFAULT_ELEVENLABS_VOICE_ID, name: 'Default' }] });
  }
});

ttsRouter.post(['/', ''], async (req: Request, res: Response) => {
  const { text, previousText, voiceId: requestedVoiceId, language: requestedLanguage } = req.body as { text?: unknown; previousText?: unknown; voiceId?: unknown; language?: unknown };
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: { message: 'Missing "text" field' } });
    return;
  }

  try {
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    res.once('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const languageCode = typeof requestedLanguage === 'string' && LANGUAGE_CODE_PATTERN.test(requestedLanguage.toLowerCase())
      ? requestedLanguage.toLowerCase()
      : inferLanguageCode(text);
    const languageVoiceId = languageCode
      ? process.env[`ELEVENLABS_VOICE_ID_${languageCode.toUpperCase()}`]
      : undefined;
    const configuredVoiceId = languageVoiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID;
    const voiceId = typeof requestedVoiceId === 'string' && VOICE_ID_PATTERN.test(requestedVoiceId)
      ? requestedVoiceId
      : configuredVoiceId;

    const context = typeof previousText === 'string' ? previousText.trim().slice(-1200) : '';
    const hasElevenLabs = Boolean(process.env.ELEVENLABS_API_KEY);
    const hasDeepgram = Boolean(process.env.DEEPGRAM_API_KEY);
    if (await streamElevenLabs(text, context, voiceId, languageCode, res, controller.signal)) return;
    // A rotated key may no longer have access to a custom voice saved by the
    // previous account. Premade voices are portable, so retry one before
    // falling back to a different provider.
    if (voiceId !== DEFAULT_ELEVENLABS_VOICE_ID
      && await streamElevenLabs(text, context, DEFAULT_ELEVENLABS_VOICE_ID, languageCode, res, controller.signal)) return;
    if ((!languageCode || languageCode === 'en') && await streamDeepgram(text, res, controller.signal)) return;

    res.status(hasElevenLabs || hasDeepgram ? 502 : 500).json({
      error: { message: hasElevenLabs || hasDeepgram
        ? 'The configured voice provider could not synthesize this response.'
        : 'No TTS provider configured. Set ELEVENLABS_API_KEY or DEEPGRAM_API_KEY.' },
    });
  } catch (error: unknown) {
    console.error('TTS route error:', error);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ error: { message: error instanceof Error ? error.message : 'Failed to synthesize audio' } });
  }
});
