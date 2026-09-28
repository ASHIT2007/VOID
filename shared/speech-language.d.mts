export function normalizeSpeechLanguage(value: unknown): string | undefined;
export function detectSpeechLanguage(text: string): string | undefined;
export function speechLanguage(text: string, fallback?: string): string;
export type NativeVoice = { voice_id?: string; labels?: Record<string, unknown>; verified_languages?: Array<{ language?: string; locale?: string }> };
export function selectNativeVoice(voices: NativeVoice[], language: string, preferredId?: string): string | undefined;
export function deepgramSpeechLanguage(selection: string, context?: string): string;
