export function inferSpeechLanguage(text: string, fallback = "en"): string {
  if (/[\u0900-\u097F]/u.test(text)) {
    if (/(?:नेपाली|तपाईं|छैन|छन्|गर्नुहोस्|हुन्छ)/u.test(text)) return "ne";
    if (/(?:मराठी|आहे|आहेत|नाही|आणि|तुम्ही|करा|मध्ये|होते|होता)/u.test(text)) return "mr";
    return "hi";
  }
  if (/[\u0980-\u09FF]/u.test(text)) return /[ৰৱ]/u.test(text) ? "as" : "bn";
  if (/[\u0A00-\u0A7F]/u.test(text)) return "pa";
  if (/[\u0A80-\u0AFF]/u.test(text)) return "gu";
  if (/[\u0B00-\u0B7F]/u.test(text)) return "or";
  if (/[\u0B80-\u0BFF]/u.test(text)) return "ta";
  if (/[\u0C00-\u0C7F]/u.test(text)) return "te";
  if (/[\u0C80-\u0CFF]/u.test(text)) return "kn";
  if (/[\u0D00-\u0D7F]/u.test(text)) return "ml";
  if (/[\u0D80-\u0DFF]/u.test(text)) return "si";
  if (/[\u0600-\u06FF]/u.test(text)) return /[ٹڈڑںھہئے]/u.test(text) ? "ur" : "ar";
  if (/[\u3040-\u30FF]/u.test(text)) return "ja";
  if (/[\uAC00-\uD7AF]/u.test(text)) return "ko";
  if (/[\u4E00-\u9FFF]/u.test(text)) return "zh";
  return fallback.split("-")[0]?.toLowerCase() || "en";
}
