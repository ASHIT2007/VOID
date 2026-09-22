export type EffortPreference = 'auto' | 'low' | 'medium' | 'high';
export function normalizeEffortPreference(value: string | null): EffortPreference {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'auto';
}
