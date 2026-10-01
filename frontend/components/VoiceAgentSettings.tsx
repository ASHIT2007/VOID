'use client';
import VoidSelect from './ui/VoidSelect';
import { useEffect, useId, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AudioLines, ChevronDown, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DEFAULT_VOICE_CONFIG, GEMINI_VOICES, OPENAI_VOICES, type VoiceConfig } from '@/lib/voice-config';
type Connection = { id: string; provider_id: string; display_name: string; enabled: boolean; status: string; capability_usage?: { voice?: boolean } };
type Model = { id: string; connection_id: string; model_id: string; display_name: string; enabled: boolean; capabilities: { text?: boolean; streaming?: boolean; voice?: boolean } };
export default function VoiceAgentSettings({ providers, models }: { providers: Connection[]; models: Model[] }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId(), reduced = useReducedMotion();
  const [config, setConfig] = useState<VoiceConfig>(DEFAULT_VOICE_CONFIG), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const headers = async () => { const { data: { session } } = await supabase.auth.getSession(); return { 'Content-Type': 'application/json', 'x-void-user-token': session?.access_token || '' }; };
  useEffect(() => { let alive = true; void headers().then(h => fetch('/api/voice/settings', { headers: h })).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); if (alive) setConfig(body.config); }).catch(err => { if (alive) setError(err.message); });
    const update = () => setBrowserVoices(window.speechSynthesis?.getVoices() || []); update(); window.speechSynthesis?.addEventListener('voiceschanged', update);
    return () => { alive = false; window.speechSynthesis?.removeEventListener('voiceschanged', update); }; }, []);
  const change = (values: Partial<VoiceConfig>) => { setConfig(current => ({ ...current, ...values })); setSaved(false); };
  const connected = providers.filter(item => item.enabled && item.status === 'connected');
  const connections = (provider: string) => connected.filter(item => item.provider_id === provider && item.capability_usage?.voice !== false);
  const voices = config.ttsProvider === 'browser' ? browserVoices.map(voice => ({ id: voice.voiceURI, name: `${voice.name} · ${voice.lang}` }))
    : config.ttsProvider === 'openai' ? [...OPENAI_VOICES, 'fable', 'nova', 'onyx'].map(id => ({ id, name: id }))
    : models.filter(model => model.connection_id === config.ttsConnectionId && model.enabled && model.capabilities.voice).map(model => ({ id: model.model_id, name: model.display_name }));
  const select = (label: string, value: string, options: Array<{ id: string; name: string }>, update: (value: string) => void, placeholder = 'Choose…') => <label className="block space-y-1.5 text-xs text-neutral-400"><span>{label}</span><VoidSelect aria-label={label} className="w-full min-w-0 rounded-xl border border-white/10 bg-[#202020] px-3 py-2.5 text-sm text-white outline-none transition focus:border-white/40" value={value} onChange={event => update(event.target.value)}><option value="">{placeholder}</option>{options.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</VoidSelect></label>;
  const connectionOptions = (provider: string) => connections(provider).map(item => ({ id: item.id, name: item.display_name }));
  const save = async () => { setBusy(true); setError(''); setSaved(false); try { const response = await fetch('/api/voice/settings', { method: 'PUT', headers: await headers(), body: JSON.stringify({ config }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setConfig(body.config); setSaved(true); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save voice settings.'); } finally { setBusy(false); } };
  return <section aria-label="Voice Agent settings" className="rounded-2xl border border-white/10 bg-[#141414] p-4 sm:p-5">
    <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)} className="flex w-full items-center gap-3 text-left"><AudioLines className="h-5 w-5 shrink-0 text-neutral-300" /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-white">Voice Agent</span></span><ChevronDown size={16} className={`text-neutral-400 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} /></button>
    <motion.div id={panelId} inert={!expanded} initial={false} animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }} transition={{ duration: reduced ? 0 : .18 }} className="overflow-hidden"><div className="space-y-4 pt-4">
    <div className="grid grid-cols-2 gap-2">{(['native', 'modular'] as const).map(mode => <button key={mode} aria-pressed={config.mode === mode} onClick={() => change({ mode })} className={`rounded-xl border px-3 py-3 text-left text-sm transition active:scale-[.98] ${config.mode === mode ? 'border-white/30 bg-white/10 text-white' : 'border-white/10 text-neutral-400 hover:bg-white/5'}`}><span className="block font-medium">{mode === 'native' ? 'Native Realtime' : 'Modular Pipeline'}</span><span className="mt-1 block text-xs opacity-70">{mode === 'native' ? 'One provider handles the conversation' : 'Mix your brain, ears and voice'}</span></button>)}</div>
    {config.mode === 'native' ? <div className="grid gap-3 sm:grid-cols-2">
      {select('Realtime provider', config.nativeProvider, [{ id: 'openai', name: 'OpenAI Realtime' }, { id: 'google', name: 'Gemini Multimodal Live' }], value => { if (value) change({ nativeProvider: value as 'openai' | 'google', nativeConnectionId: '', nativeModel: value === 'openai' ? 'gpt-realtime-2.1' : 'gemini-3.8-live', nativeVoice: value === 'openai' ? 'marin' : 'Kore' }); })}
      {select('Realtime connection', config.nativeConnectionId, connectionOptions(config.nativeProvider), nativeConnectionId => change({ nativeConnectionId }), 'Connect a provider first')}
      {select('Realtime model', config.nativeModel, (config.nativeProvider === 'openai' ? ['gpt-realtime-2.1', 'gpt-realtime', 'gpt-realtime-mini'] : ['gemini-3.8-live', 'gemini-3.1-flash-live-preview']).map(id => ({ id, name: id })), nativeModel => change({ nativeModel }))}
      {select('Realtime voice', config.nativeVoice, (config.nativeProvider === 'openai' ? OPENAI_VOICES : GEMINI_VOICES).map(id => ({ id, name: id })), nativeVoice => change({ nativeVoice }))}
      <p className="sm:col-span-2 text-xs leading-relaxed text-neutral-500">Direct realtime audio uses a temporary session credential. Availability and response time depend on your provider, model access and network.</p>
    </div> : <div className="space-y-4">
      {select('Brain · connected text model', config.brainModelId, models.filter(model => model.enabled && model.capabilities.text && model.capabilities.streaming && connected.some(connection => connection.id === model.connection_id)).map(model => ({ id: model.id, name: `${model.display_name} · ${connected.find(connection => connection.id === model.connection_id)?.display_name}` })), brainModelId => change({ brainModelId }))}
      <div className="grid gap-3 sm:grid-cols-2">{select('Speech-to-text', config.sttProvider, [{ id: 'browser', name: 'Browser Free Speech' }, { id: 'deepgram', name: 'Deepgram' }, { id: 'groq', name: 'Groq Whisper' }, { id: 'openai', name: 'OpenAI Whisper' }], value => { if (value) change({ sttProvider: value as VoiceConfig['sttProvider'], sttConnectionId: '' }); })}
        {config.sttProvider !== 'browser' && select('Transcription connection', config.sttConnectionId, connectionOptions(config.sttProvider), sttConnectionId => change({ sttConnectionId }))}</div>
      <div className="grid gap-3 sm:grid-cols-2">{select('Text-to-speech', config.ttsProvider, [{ id: 'browser', name: 'Browser Free Speech' }, { id: 'elevenlabs', name: 'ElevenLabs' }, { id: 'cartesia', name: 'Cartesia' }, { id: 'openai', name: 'OpenAI TTS' }], value => { if (value) change({ ttsProvider: value as VoiceConfig['ttsProvider'], ttsConnectionId: '', ttsVoice: value === 'openai' ? 'marin' : '' }); })}
        {config.ttsProvider !== 'browser' && select('Speech connection', config.ttsConnectionId, connectionOptions(config.ttsProvider), ttsConnectionId => change({ ttsConnectionId, ttsVoice: config.ttsProvider === 'openai' ? 'marin' : '' }))}
        {select('Speaking voice', config.ttsVoice, voices, ttsVoice => change({ ttsVoice }), config.ttsProvider === 'browser' ? 'Automatic · match language' : 'Choose a voice')}
      </div>
      <p className="text-xs leading-relaxed text-neutral-500">Browser speech depends on installed voices and browser support; recognition may use your browser’s cloud service. Provider audio and text use only the connections selected here.</p>
    </div>}
    {error && <p role="alert" className="text-xs text-neutral-300">{error}</p>}
    <button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-medium text-black transition hover:bg-neutral-200 active:scale-[.98] disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}{saved ? 'Voice settings saved' : 'Save voice settings'}</button>
    </div></motion.div></section>;
}
