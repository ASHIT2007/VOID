'use client';
import { useLayoutEffect, useState } from 'react';
import SettingsPage from '@/components/SettingsPage';
import { defaultExecutionConfig } from '@void/shared/execution-config.mjs';
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export default function SettingsPreview() {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const original = window.fetch.bind(window);
    const providers = [
      { id: id(1), provider_id: 'elevenlabs', display_name: 'ElevenLabs', masked_key: 'sk_••••4c16', enabled: true, status: 'connected' },
      { id: id(2), provider_id: 'custom', display_name: 'Nvidia Kimi', base_url: 'https://integrate.api.nvidia.com/v1', masked_key: 'nv••••0wjW', enabled: true, status: 'connected' },
      { id: id(3), provider_id: 'google', display_name: 'Google Gemini', masked_key: 'AI••••QNvw', enabled: true, status: 'connected' },
      { id: id(4), provider_id: 'groq', display_name: 'Groq', masked_key: 'gsk_••••UHYN', enabled: true, status: 'connected' },
    ];
    const models = [
      { id: id(10), connection_id: id(2), display_name: 'Kimi K2.5', model_id: 'moonshotai/kimi-k2.5', enabled: true, priority: 10, capabilities: { text: true, streaming: true, toolCalling: true } },
      { id: id(11), connection_id: id(3), display_name: 'Gemini Flash', model_id: 'gemini-flash', enabled: true, priority: 0, capabilities: { text: true, streaming: true, toolCalling: true } },
      { id: id(12), connection_id: id(3), display_name: 'Gemini Image', model_id: 'gemini-image', enabled: true, priority: 0, capabilities: { imageGeneration: true } },
      { id: id(13), connection_id: id(4), display_name: 'GPT-OSS 120B', model_id: 'openai/gpt-oss-120b', enabled: true, priority: 0, capabilities: { text: true, streaming: true, toolCalling: true } },
      { id: id(14), connection_id: id(4), display_name: 'GPT-OSS 20B', model_id: 'openai/gpt-oss-20b', enabled: true, priority: 0, capabilities: { text: true, streaming: true, toolCalling: true } },
    ];
    let config = defaultExecutionConfig(id(10)), preferences = { default_mode: 'AUTO', image_model_id: id(12) };
    window.fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith('/api/ai/') && url !== '/api/voice/settings') return original(input, init);
      const method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : {};
      if (method !== 'GET') await new Promise(resolve => setTimeout(resolve, 1800));
      if (url === '/api/ai/providers') { if (method === 'PATCH') { const provider = providers.find(item => item.id === body.id); if (provider && body.action === 'toggle') provider.enabled = body.enabled; } return Response.json({ providers, models, preferences }); }
      if (url === '/api/ai/models') { const model = models.find(item => item.id === body.id); if (model) Object.assign(model, body); return Response.json({ ok: true }); }
      if (url === '/api/ai/preferences') { preferences = { ...preferences, default_mode: body.mode, image_model_id: body.imageModelId }; return Response.json({ ok: true }); }
      if (url === '/api/ai/execution') { if (method === 'PATCH') config = body.config; return Response.json({ config }); }
      if (url === '/api/voice/settings') { const { DEFAULT_VOICE_CONFIG } = await import('@/lib/voice-config'); return Response.json({ config: DEFAULT_VOICE_CONFIG }); }
      return Response.json({ ok: true });
    };
    setReady(true); return () => { window.fetch = original; };
  }, []);
  return <div className="min-h-screen bg-[#101010] text-white">{ready && <SettingsPage onClose={() => {}} />}<span className="fixed bottom-1 left-2 z-[60] text-[9px] text-neutral-500">Development preview · sample connections · saves stay on this page</span></div>;
}
