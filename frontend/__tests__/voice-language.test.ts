import { describe, it, expect } from 'vitest';
import { inferSpeechLanguage, detectSpeechLanguage, deepgramSpeechLanguage } from '@/lib/voice-language';
import { selectNativeVoice } from '@void/shared/speech-language.mjs';
import { multilingualSpeechBody } from '@/lib/ai/speech-provider';

describe('multilingual speech routing', () => {
  it('detects Hindi and Romanized Hinglish without forcing English', () => {
    expect(inferSpeechLanguage('Mujhe photosynthesis simple words mein samjhao')).toBe('hi');
    expect(inferSpeechLanguage('Aap kaise ho?')).toBe('hi');
    expect(inferSpeechLanguage('यह example बहुत अच्छा है')).toBe('hi');
    expect(inferSpeechLanguage('ठीक है', 'en-US')).toBe('hi');
  });
  it('retains the prior language for brief acknowledgements and honors explicit switches', () => {
    expect(inferSpeechLanguage('Okay', 'hi')).toBe('hi');
    expect(detectSpeechLanguage('Please reply in English')).toBe('en');
    expect(inferSpeechLanguage('hello there', 'fr-FR')).toBe('fr');
    expect(detectSpeechLanguage('the main character is strong')).toBeUndefined();
  });
  it('detects regional and non-Latin scripts', () => {
    for (const [text, code] of [['हे मराठी आहे', 'mr'], ['ગુજરાતી', 'gu'], ['தமிழ்', 'ta'], ['తెలుగు', 'te'], ['ಕನ್ನಡ', 'kn'], ['മലയാളം', 'ml'], ['বাংলা', 'bn'], ['ਪੰਜਾਬੀ', 'pa'], ['ไทย', 'th'], ['Ελληνικά', 'el'], ['日本語の説明', 'ja'], ['Українська', 'uk']]) {
      expect(inferSpeechLanguage(text)).toBe(code);
    }
  });
  it('prefers a native Hindi voice over the saved American voice', () => {
    const voices = [
      { voice_id: 'AmericanVoice123', labels: { language: 'en', accent: 'american' } },
      { voice_id: 'HindiVoice12345', labels: { language: 'hi', accent: 'indian' } },
    ];
    expect(selectNativeVoice(voices, 'hi', 'AmericanVoice123')).toBe('HindiVoice12345');
    expect(selectNativeVoice([{ voice_id: 'TamilVoice12345', verified_languages: [{ language: 'ta' }] }, ...voices], 'ta')).toBe('TamilVoice12345');
  });
  it('uses multilingual synthesis for regional and mixed speech', () => {
    const body = JSON.parse(multilingualSpeechBody('यह concept समझिए', 'hi', 'Previous sentence'));
    expect(body.model_id).toBe('eleven_flash_v2_5'); expect(body.language_code).toBe('hi');
    expect(body.previous_text).toBe('Previous sentence');
    expect(JSON.parse(multilingualSpeechBody('Hello', 'en')).model_id).toBe('eleven_flash_v2_5');
    expect(JSON.parse(multilingualSpeechBody('मराठीमध्ये उत्तर द्या', 'mr')).model_id).toBe('eleven_v3');
    expect(JSON.parse(multilingualSpeechBody('తెలుగు', 'te')).model_id).toBe('eleven_v3');
    expect(JSON.parse(multilingualSpeechBody('தமிழ்', 'ta')).model_id).toBe('eleven_flash_v2_5');
  });
  it('routes regional recognition explicitly while retaining Hinglish code-switching', () => {
    expect(deepgramSpeechLanguage('hi')).toBe('multi');
    expect(deepgramSpeechLanguage('ta')).toBe('ta');
    expect(deepgramSpeechLanguage('auto', 'gu')).toBe('gu');
    expect(deepgramSpeechLanguage('auto')).toBe('multi');
  });
});
