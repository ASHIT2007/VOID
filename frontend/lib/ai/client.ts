import 'server-only';
import { backendHeaders, backendUrl } from '@/lib/backend';
import { loadByokContext } from './server';

export interface VoidGenerationRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxOutputTokens?: number;
  requireStructured?: boolean;
  signal?: AbortSignal;
}

export interface VoidGenerationResponse {
  text: string;
  providerId: string;
  modelId: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  fallbackCount: number;
}

export async function generateUserText(userId: string, request: VoidGenerationRequest): Promise<VoidGenerationResponse> {
  const byok = await loadByokContext(userId);
  if (!byok.models.length) throw new Error('Connect an AI provider in Settings to use this feature.');
  const response = await fetch(backendUrl('/api/ai/generate'), {
    method: 'POST', headers: backendHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ byok, messages: request.messages, maxOutputTokens: request.maxOutputTokens ?? 2000,
      requireStructured: request.requireStructured ?? false }),
    signal: request.signal || AbortSignal.timeout(55_000), cache: 'no-store',
  });
  if (!response.ok) throw new Error('A connected model could not complete this request.');
  const result = await response.json() as VoidGenerationResponse;
  // Helper calls return their usage to callers; usage logs are not cloud-synced.
  return result;
}
