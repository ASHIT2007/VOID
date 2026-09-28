const names = { hindi: 'hi', hinglish: 'hi', english: 'en', marathi: 'mr', bengali: 'bn', bangla: 'bn', tamil: 'ta', telugu: 'te', kannada: 'kn', malayalam: 'ml', gujarati: 'gu', punjabi: 'pa', urdu: 'ur', nepali: 'ne', arabic: 'ar', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it', russian: 'ru', japanese: 'ja', korean: 'ko', chinese: 'zh', persian: 'fa', dutch: 'nl', thai: 'th', vietnamese: 'vi', indonesian: 'id', turkish: 'tr', greek: 'el', hebrew: 'he', ukrainian: 'uk', polish: 'pl', swedish: 'sv', finnish: 'fi', danish: 'da', romanian: 'ro', hungarian: 'hu', czech: 'cs', sinhala: 'si', assamese: 'as', odia: 'or' };
export function normalizeSpeechLanguage(value) {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().toLowerCase();
  return names[clean] || (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(clean) ? clean.split('-')[0] : undefined);
}
export function detectSpeechLanguage(text) {
  if (typeof text !== 'string') return undefined;
  const explicit = text.match(/\b(?:speak|reply|answer|respond|talk|explain)(?:\s+to\s+me)?(?:\s+only)?(?:\s+in)?\s+(hindi|hinglish|english|marathi|bengali|tamil|telugu|kannada|malayalam|gujarati|punjabi|urdu|nepali|spanish|french|german|arabic|russian|japanese|korean|chinese)\b/i);
  if (explicit) return normalizeSpeechLanguage(explicit[1]);
  if (/[\u0900-\u097F]/u.test(text)) {
    if (/(?:नेपाली|तपाईं|छैन|छन्|गर्नुहोस्|हुन्छ)/u.test(text)) return 'ne';
    return /(?:मराठी|आहे|आहेत|नाही|आणि|तुम्ही|मध्ये)/u.test(text) ? 'mr' : 'hi';
  }
  const scripts = [[/[\u0980-\u09FF]/u, /[ৰৱ]/u.test(text) ? 'as' : 'bn'], [/\p{Script=Gurmukhi}/u, 'pa'], [/\p{Script=Gujarati}/u, 'gu'], [/\p{Script=Oriya}/u, 'or'], [/\p{Script=Tamil}/u, 'ta'], [/\p{Script=Telugu}/u, 'te'], [/\p{Script=Kannada}/u, 'kn'], [/\p{Script=Malayalam}/u, 'ml'], [/\p{Script=Sinhala}/u, 'si'], [/\p{Script=Thai}/u, 'th'], [/\p{Script=Greek}/u, 'el'], [/\p{Script=Hebrew}/u, 'he'], [/\p{Script=Georgian}/u, 'ka'], [/\p{Script=Armenian}/u, 'hy'], [/\p{Script=Hiragana}|\p{Script=Katakana}/u, 'ja'], [/\p{Script=Hangul}/u, 'ko'], [/\p{Script=Han}/u, 'zh']];
  for (const [pattern, code] of scripts) if (pattern.test(text)) return code;
  if (/\p{Script=Arabic}/u.test(text)) return /[ٹڈڑںھہئے]/u.test(text) ? 'ur' : /[پچژگ]/u.test(text) ? 'fa' : 'ar';
  if (/\p{Script=Cyrillic}/u.test(text)) return /[іїєґ]/iu.test(text) ? 'uk' : 'ru';
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  const hindi = new Set(['aap', 'tum', 'tumhara', 'mujhe', 'mera', 'mere', 'kya', 'kaise', 'kyun', 'kyu', 'hai', 'hain', 'hoon', 'nahi', 'nahin', 'achha', 'accha', 'theek', 'batao', 'bataiye', 'samjhao', 'samjha', 'karna', 'karo', 'chahiye', 'namaste', 'dhanyavaad']);
  if (words.filter(word => hindi.has(word)).length >= 2 || /\b(?:hinglish|namaste|dhanyavaad)\b/i.test(text)) return 'hi';
  return undefined;
}
export function speechLanguage(text, fallback = 'en') {
  return detectSpeechLanguage(text) || normalizeSpeechLanguage(fallback) || 'en';
}
export function selectNativeVoice(voices, language, preferredId) {
  const code = normalizeSpeechLanguage(language);
  const score = voice => {
    const labels = voice.labels || {};
    const native = normalizeSpeechLanguage(labels.language) === code;
    const verified = (voice.verified_languages || []).some(item => normalizeSpeechLanguage(item.language || item.locale) === code);
    const indian = /indian|hindi|india/i.test(String(labels.accent || '')) && ['hi', 'en', 'mr', 'bn', 'ta', 'te', 'kn', 'ml', 'gu', 'pa'].includes(code);
    return (native ? 100 : 0) + (verified ? 50 : 0) + (indian ? 30 : 0) + (voice.voice_id === preferredId ? 10 : 0);
  };
  return [...voices].filter(voice => /^[A-Za-z0-9_-]{10,64}$/.test(voice.voice_id || '')).sort((a, b) => score(b) - score(a))[0]?.voice_id;
}
export function deepgramSpeechLanguage(selection, context) {
  const code = normalizeSpeechLanguage(selection === 'auto' ? context : selection);
  // Nova-3 multi supports these code-switching languages. Other regional
  // languages need an explicit locale instead of a universal multi setting.
  return !code || ['en', 'hi', 'es', 'fr', 'de', 'ru', 'pt', 'ja', 'it', 'nl'].includes(code) ? 'multi' : code;
}
