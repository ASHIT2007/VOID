"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Brain, ChevronDown, Ellipsis, Plus, RefreshCw, SlidersHorizontal, Sparkles, Star, X, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import ProviderLogo from './ProviderLogo';
import ExecutionSettings from './ExecutionSettings';
import { defaultExecutionConfig, type ExecutionConfig } from '@void/shared/execution-config.mjs';
import VoiceAgentSettings from './VoiceAgentSettings';

type Capability = {
  text?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  toolCalling?: boolean;
  structuredOutput?: boolean;
  streaming?: boolean;
  imageGeneration?: boolean;
  imageEditing?: boolean;
  voice?: boolean;
};

type TaskCapability = 'chat' | 'tools' | 'image' | 'imageEditing' | 'voice';

export type Connection = {
  id: string;
  provider_id: string;
  display_name: string;
  masked_key: string;
  status: string;
  enabled: boolean;
  capability_usage?: Partial<Record<TaskCapability, boolean>>;
  last_validated_at?: string | null;
  base_url?: string | null;
};

export type Model = {
  id: string;
  connection_id: string;
  model_id: string;
  display_name: string;
  capabilities: Capability;
  enabled: boolean;
  priority: number;
};

type Preferences = {
  default_mode: string;
  preferred_model_id?: string | null;
  image_model_id?: string | null;
  voice_connection_id?: string | null;
  fallback_enabled?: boolean;
};

type Snapshot = {
  providers: Connection[];
  models: Model[];
  preferences: Preferences;
  schemaOutdated?: boolean;
  managed?: { chat: boolean; image: boolean; voice: boolean };
};

const choices = [
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['google', 'Google Gemini'],
  ['groq', 'Groq'],
  ['mistral', 'Mistral'],
  ['openrouter', 'OpenRouter'],
  ['elevenlabs', 'ElevenLabs'],
  ['deepgram', 'Deepgram'],
  ['cartesia', 'Cartesia'],
  ['custom', 'Custom API'],
] as const;

const features: Array<[string, keyof Capability, TaskCapability]> = [
  ['Chat', 'text', 'chat'],
  ['Tools', 'toolCalling', 'tools'],
  ['Image', 'imageGeneration', 'image'],
  ['Image editing', 'imageEditing', 'imageEditing'],
  ['Voice', 'voice', 'voice'],
];

const MODES = [
  { id: 'AUTO', label: 'Auto', icon: Sparkles },
  { id: 'FAST', label: 'Fast', icon: Zap },
  { id: 'DEEP', label: 'Deep', icon: Brain },
  { id: 'MANUAL', label: 'Manual', icon: SlidersHorizontal },
];

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token ? { 'x-void-user-token': session.access_token } : {})
  };
}

export default function ProviderSettings({ view = 'providers', onConnect }: { view?: 'providers' | 'orchestration' | 'routing'; onConnect?: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    providers: [],
    models: [],
    preferences: { default_mode: 'AUTO', fallback_enabled: true }
  });
  const [providerId, setProviderId] = useState('openai');
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [replacing, setReplacing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuDirection, setMenuDirection] = useState<'down' | 'up'>('down');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [execution, setExecution] = useState<ExecutionConfig>(defaultExecutionConfig());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const snapshotRef = useRef(snapshot);
  const queues = useRef(new Map<string, Promise<void>>());
  const revisions = useRef(new Map<string, number>());
  const confirmed = useRef(new Map<string, Connection | Model | Preferences>());

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
    // Finish pending writes before refreshing their confirmed state.
    while (queues.current.size) await Promise.allSettled([...queues.current.values()]);
    const headers = await authHeaders();
    const res = await fetch('/api/ai/providers', { headers, cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load providers.');
    snapshotRef.current = data;
    setSnapshot(data);
    const executionResponse = await fetch('/api/ai/execution', { headers, cache: 'no-store' });
    const settings = await executionResponse.json();
    if (!executionResponse.ok) throw new Error(settings.error || 'Could not load execution settings.');
    setExecution(settings.config);
    setLoaded(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load settings.');
      throw error;
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch(error => setNotice(error.message));
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Auto-dismiss notices after 4 seconds
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function request(url: string, method: string, body?: Record<string, unknown>) {
    const response = await fetch(url, {
      method,
      headers: await authHeaders(),
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The request failed.');
    return data;
  }

  async function perform(id: string, operation: string, body: Record<string, unknown> = {}) {
    if (operation === 'toggle' || operation === 'capability') {
      const previous = snapshotRef.current.providers.find(item => item.id === id);
      if (!previous) return;
      const task = `provider:${id}`;
      if (!confirmed.current.has(task)) confirmed.current.set(task, previous);
      const changes = operation === 'toggle' ? { enabled: body.enabled as boolean }
        : { capability_usage: { ...previous.capability_usage, [body.capability as TaskCapability]: body.enabled as boolean } };
      await optimisticUpdate(task, () => {
        const next = { ...snapshotRef.current, providers: snapshotRef.current.providers.map(item => item.id === id ? { ...item, ...changes } : item) };
        snapshotRef.current = next; setSnapshot(next);
      }, () => {
        const next = { ...snapshotRef.current, providers: snapshotRef.current.providers.map(item => item.id === id ? confirmed.current.get(task) as Connection : item) };
        snapshotRef.current = next; setSnapshot(next);
      }, () => request('/api/ai/providers', 'PATCH', { id, action: operation, ...body }), () => {
        const base = confirmed.current.get(task) as Connection;
        confirmed.current.set(task, { ...base, ...(operation === 'toggle' ? { enabled: body.enabled as boolean } : { capability_usage: { ...base.capability_usage, [body.capability as TaskCapability]: body.enabled as boolean } }) });
      });
      return;
    }
    setBusy(id);
    setNotice('');
    try {
      await request('/api/ai/providers', 'PATCH', { id, action: operation, ...body });
      if (operation === 'replace') {
        setReplacing(null);
        setKey('');
      }
      setNotice(operation === 'test' ? 'Connection healthy' : 'Updated');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  async function optimisticUpdate(id: string, apply: () => void, rollback: () => void, persist: () => Promise<unknown>, confirm: () => void) {
    const revision = (revisions.current.get(id) || 0) + 1;
    revisions.current.set(id, revision); apply();
    const queued = (queues.current.get(id) || Promise.resolve()).catch(() => {}).then(persist).then(() => {
      confirm();
      if (revisions.current.get(id) === revision) rollback(); // Reconcile with confirmed saves, including earlier failed toggles.
      window.dispatchEvent(new CustomEvent('providersUpdated'));
    }).catch(error => {
      if (revisions.current.get(id) === revision) rollback();
      setNotice(error instanceof Error ? error.message : 'Could not save the change.');
    });
    queues.current.set(id, queued);
    await queued;
    if (queues.current.get(id) === queued) { queues.current.delete(id); confirmed.current.delete(id); }
  }

  async function savePreferences(changes: Partial<Preferences>) {
    const task = 'preferences';
    if (!confirmed.current.has(task)) confirmed.current.set(task, snapshotRef.current.preferences);
    await optimisticUpdate(task, () => {
      snapshotRef.current = { ...snapshotRef.current, preferences: { ...snapshotRef.current.preferences, ...changes } }; setSnapshot(snapshotRef.current);
    }, () => {
      snapshotRef.current = { ...snapshotRef.current, preferences: confirmed.current.get(task) as Preferences }; setSnapshot(snapshotRef.current);
    }, () => {
      const next = { ...confirmed.current.get(task) as Preferences, ...changes };
      return request('/api/ai/preferences', 'PATCH', {
        mode: next.default_mode,
        modelId: next.preferred_model_id || null,
        imageModelId: next.image_model_id || null,
        voiceConnectionId: next.voice_connection_id || null,
        fallbackEnabled: next.fallback_enabled !== false
      });
    }, () => { confirmed.current.set(task, { ...confirmed.current.get(task) as Preferences, ...changes }); });
  }

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy('connect');
    setNotice('');
    try {
      const result = await request('/api/ai/providers', 'POST', {
        providerId,
        apiKey: key,
        displayName: name,
        ...(providerId === 'custom' ? { baseUrl, modelId: customModel } : {})
      });
      setKey('');
      setName('');
      setBaseUrl('');
      setCustomModel('');
      setIsAdding(false);
      setNotice(`Connected · ${result.modelCount} models ready`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Connection failed');
    } finally {
      setBusy(null);
    }
  }

  async function updateModel(id: string, changes: Record<string, unknown>) {
    const previous = snapshotRef.current.models.find(item => item.id === id);
    if (!previous) return;
    const task = `model:${id}`;
    if (!confirmed.current.has(task)) confirmed.current.set(task, previous);
    const change = (values: Record<string, unknown>) => { const next = { ...snapshotRef.current, models: snapshotRef.current.models.map(item => item.id === id ? { ...item, ...values } : item) }; snapshotRef.current = next; setSnapshot(next); };
    await optimisticUpdate(task, () => change(changes), () => change(confirmed.current.get(task) as Model), () => request('/api/ai/models', 'PATCH', { id, ...changes }), () => confirmed.current.set(task, { ...confirmed.current.get(task) as Model, ...changes }));
  }

  async function remove(connection: Connection) {
    if (!window.confirm(`Disconnect ${connection.display_name}?`)) return;
    setBusy(connection.id);
    try {
      await request(`/api/ai/providers?id=${encodeURIComponent(connection.id)}`, 'DELETE');
      await load();
      setNotice('Disconnected');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not disconnect');
    } finally {
      setBusy(null);
    }
  }

  const active = snapshot.models.filter(model =>
    model.enabled && snapshot.providers.some(provider => provider.id === model.connection_id && provider.enabled && provider.status === 'connected')
  );
  const chatModels = active.filter(model => model.capabilities.text && model.capabilities.streaming && snapshot.providers.find(provider => provider.id === model.connection_id)?.capability_usage?.chat !== false);
  const imageModels = active.filter(model => model.capabilities.imageGeneration && snapshot.providers.find(provider => provider.id === model.connection_id)?.capability_usage?.image !== false);
  const selectedImage = imageModels.find(model => model.id === snapshot.preferences.image_model_id);
  const imageConnectionId = selectedImage?.connection_id || '';

  const currentMode = snapshot.preferences.default_mode || 'AUTO';
  return (
    <>
    {loadError && <div role="alert" className="mx-auto mb-4 flex max-w-2xl items-center justify-between gap-3 rounded-xl border border-white/10 p-4 text-xs text-neutral-300"><span>{loadError}</span><button disabled={loading} onClick={() => void load().catch(() => {})} aria-label="Retry loading settings" title="Retry" className="rounded-lg p-2 hover:bg-white/10"><RefreshCw size={16} /></button></div>}
    <div hidden={view === 'providers'} className="mx-auto max-w-2xl pb-8">{loaded ? <ExecutionSettings view={view === 'routing' ? 'routing' : 'orchestration'} config={execution} models={chatModels} providers={snapshot.providers} onConnect={() => { setIsAdding(true); onConnect?.(); }} save={async config => {
      const data = await request('/api/ai/execution', 'PATCH', { config }); setExecution(data.config); window.dispatchEvent(new CustomEvent('providersUpdated'));
    }} /> : !loadError && <p role="status" className="py-10 text-center text-xs text-neutral-400">Loading…</p>}</div>
    <div hidden={view !== 'providers'} className="mx-auto max-w-2xl space-y-5 pb-8 text-neutral-100">
      {/* ── Top Header & Mode Switcher ────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-white">AI Providers</h3>
          <p className="text-xs text-neutral-400">
            {snapshot.providers.filter(p => p.enabled).length} active · {active.length} models ready
          </p>
        </div>

        {/* Minimal Monocolor Segmented Control */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-white/[0.08] bg-[#121212] p-0.5">
            {MODES.map(mode => {
              const isActive = currentMode === mode.id;
              const ModeIcon = mode.icon;
              return (
                <button
                  key={mode.id}
                  aria-label={mode.label}
                  title={mode.label}
                  aria-pressed={isActive}
                  onClick={() => savePreferences({
                    default_mode: mode.id,
                    preferred_model_id: mode.id === 'MANUAL'
                      ? snapshot.preferences.preferred_model_id || chatModels[0]?.id || null
                      : snapshot.preferences.preferred_model_id
                  })}
                  className="relative rounded-lg p-2.5 transition-colors"
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeModePill"
                      transition={{ type: "spring", stiffness: 450, damping: 35 }}
                      className="absolute inset-0 rounded-lg bg-white shadow-sm"
                    />
                  )}
                  <span className={`relative z-10 transition-colors ${isActive ? 'text-black font-semibold' : 'text-neutral-400 hover:text-white'}`}>
                    <ModeIcon size={15} />
                  </span>
                </button>
              );
            })}
          </div>

          {/* Refresh Button */}
          <button
            onClick={() => load().catch(err => setNotice(err.message))}
            disabled={busy !== null || loading}
            aria-label="Refresh providers"
            className="rounded-xl border border-white/[0.08] bg-[#121212] p-2 text-neutral-400 transition-colors hover:text-white disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />
          </button>
        </div>
      </div>

      {/* ── Main Unified Provider Inset Container ────────────────────────── */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#121212] divide-y divide-white/[0.06]">
        {snapshot.providers.length === 0 ? (
          <div className="px-6 py-10 text-center rounded-2xl">
            <p className="text-xs text-neutral-400">No providers connected yet</p>
          </div>
        ) : (
          snapshot.providers.map((connection, index) => {
            const models = snapshot.models.filter(m => m.connection_id === connection.id);
            const isExpanded = expanded === connection.id;
            const isMenuOpen = menu === connection.id;

            return (
              <div key={connection.id} className={`group transition-colors ${index === 0 ? 'first:rounded-t-2xl' : ''} ${isMenuOpen ? 'relative z-30' : ''}`}>
                {/* Provider Row */}
                <div className={`flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors ${index === 0 ? 'rounded-t-2xl' : ''}`}>
                  {/* Left: Logo, Name, Status, Masked Key */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#161616] text-white">
                      <ProviderLogo providerId={connection.provider_id} name={connection.display_name} baseUrl={connection.base_url} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white truncate">
                          {connection.display_name}
                        </span>
                        <span
                          className={`size-1.5 rounded-full ${
                            connection.enabled && connection.status === 'connected'
                              ? 'bg-neutral-200'
                              : 'bg-neutral-600'
                          }`}
                        />
                        <span className="hidden font-mono text-[11px] text-neutral-500 sm:inline">
                          {connection.masked_key}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-500">
                        {models.length} {['elevenlabs', 'cartesia'].includes(connection.provider_id) ? 'voices' : 'models'}
                      </p>
                    </div>
                  </div>

                  {/* Right: Toggle Switch & Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Toggle Connection Switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={connection.enabled}
                      aria-label={`Enable ${connection.display_name}`}
                      onClick={() => perform(connection.id, 'toggle', { enabled: !connection.enabled })}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out disabled:opacity-40 ${
                        connection.enabled ? 'bg-white' : 'bg-neutral-800'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block size-3.5 transform rounded-full bg-black shadow transition duration-200 ease-in-out mt-[2px] ml-[2px] ${
                          connection.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>

                    {/* Expand Models Chevron */}
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : connection.id)}
                      className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/[0.06] hover:text-white transition-colors"
                      title="Manage models"
                      aria-label={`Manage ${connection.display_name} models`}
                      aria-expanded={isExpanded}
                    >
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-200 ${isExpanded ? 'rotate-180 text-white' : ''}`}
                      />
                    </button>

                    {/* Context Menu Button */}
                    <div className="relative">
                      <button
                        type="button"
                        aria-label={`${connection.display_name} options`}
                        title="Provider options"
                        aria-expanded={isMenuOpen}
                        onClick={(e) => {
                          if (isMenuOpen) {
                            setMenu(null);
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const spaceBelow = window.innerHeight - rect.bottom;
                            setMenuDirection(spaceBelow < 180 ? 'up' : 'down');
                            setMenu(connection.id);
                          }
                        }}
                        className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/[0.06] hover:text-white transition-colors"
                      >
                        <Ellipsis size={14} />
                      </button>

                      {/* Dropdown Menu */}
                      <AnimatePresence>
                        {isMenuOpen && (
                          <>
                            {/* Click outside backdrop */}
                            <div
                              className="fixed inset-0 z-40 cursor-default"
                              onClick={() => setMenu(null)}
                            />
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95, y: menuDirection === 'up' ? 4 : -4 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: menuDirection === 'up' ? 4 : -4 }}
                              transition={{ duration: 0.12 }}
                              className={`absolute right-0 z-50 w-44 rounded-xl border border-white/[0.1] bg-[#181818] p-1 shadow-2xl backdrop-blur-xl ${
                                menuDirection === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                              }`}
                            >
                              <button
                                onClick={() => { setMenu(null); perform(connection.id, 'test'); }}
                                className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-white/10 hover:text-white transition-colors"
                              >
                                Test Connection
                              </button>
                              <button
                                onClick={() => { setMenu(null); perform(connection.id, 'refresh'); }}
                                className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-white/10 hover:text-white transition-colors"
                              >
                                Refresh Models
                              </button>
                              <button
                                onClick={() => { setMenu(null); setReplacing(connection.id); }}
                                className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-white/10 hover:text-white transition-colors"
                              >
                                Update Key
                              </button>
                              <div className="my-1 border-t border-white/[0.06]" />
                              <button
                                onClick={() => { setMenu(null); remove(connection); }}
                                className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-neutral-400 hover:bg-white/10 transition-colors"
                              >
                                Disconnect
                              </button>
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Expanded Models Drawer */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden border-t border-white/[0.04] bg-[#0c0c0c]/80 px-4 py-3"
                    >
                      {/* Capability Toggles */}
                      <div className="mb-3 flex flex-wrap gap-2">
                        {features.filter(([, field, capability]) => models.some(model => model.capabilities[field]) || capability === 'voice' && ['elevenlabs', 'deepgram', 'cartesia'].includes(connection.provider_id)).map(([label, , capability]) => {
                          const isEnabled = connection.capability_usage?.[capability] !== false;
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() => perform(connection.id, 'capability', { capability, enabled: !isEnabled })}
                              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                isEnabled
                                  ? 'border-white/20 bg-white/10 text-white'
                                  : 'border-white/[0.06] text-neutral-500 hover:text-neutral-300'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Models List */}
                      {models.length > 0 && (
                        <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                          {models.map(model => (
                            <div
                              key={model.id}
                              className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs hover:bg-white/[0.03] transition-colors"
                            >
                              <span className="truncate text-neutral-300 font-mono text-[11px] max-w-[280px]">
                                {model.display_name}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {model.capabilities.text && (
                                  <button
                                    type="button"
                                    onClick={() => updateModel(model.id, { priority: model.priority > 0 ? 0 : 5 })}
                                    className={`rounded-md p-1 text-[10px] transition-colors ${
                                      model.priority > 0
                                        ? 'text-white'
                                        : 'text-neutral-500 hover:text-neutral-300'
                                    }`}
                                    title="Prioritize model"
                                  >
                                    <Star size={12} fill={model.priority > 0 ? "currentColor" : "none"} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={model.enabled}
                                  aria-label={`Enable ${model.display_name}`}
                                  onClick={() => updateModel(model.id, { enabled: !model.enabled })}
                                  className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                    model.enabled
                                      ? 'bg-white/15 text-white'
                                      : 'text-neutral-500 hover:text-neutral-300'
                                  }`}
                                >
                                  {model.enabled ? 'Active' : 'Off'}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Inline Update Key Form */}
                <AnimatePresence>
                  {replacing === connection.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-t border-white/[0.04] bg-[#0c0c0c] px-4 py-3"
                    >
                      <form
                        onSubmit={e => {
                          e.preventDefault();
                          perform(connection.id, 'replace', { apiKey: key });
                        }}
                        className="flex gap-2"
                      >
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={key}
                          onChange={e => setKey(e.target.value)}
                          placeholder="New API Key"
                          required
                          className="flex-1 rounded-xl border border-white/[0.1] bg-[#161616] px-3 py-1.5 text-xs text-white placeholder:text-neutral-500 outline-none focus:border-white/30"
                        />
                        <button
                          type="button"
                          onClick={() => { setReplacing(null); setKey(''); }}
                          className="rounded-xl px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={busy === connection.id}
                          className="rounded-xl bg-white px-3.5 py-1.5 text-xs font-semibold text-black hover:bg-neutral-200 transition-colors disabled:opacity-50"
                        >
                          Save
                        </button>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}

        {/* ── Expandable "+ Connect Provider" Row ───────────────────────── */}
        <div className="bg-[#101010] rounded-b-2xl">
          {!isAdding ? (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              aria-label="Connect provider"
              title="Connect provider"
              className="flex w-full items-center justify-center gap-2 py-3 text-xs font-medium text-neutral-400 transition-colors hover:bg-white/[0.02] hover:text-white rounded-b-2xl"
            >
              <Plus size={18} />
            </button>
          ) : (
            <motion.form
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onSubmit={connect}
              className="overflow-hidden p-4 space-y-3 rounded-b-2xl"
            >
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs font-medium text-white">Add Provider Key</span>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="rounded-lg p-1 text-neutral-500 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={providerId}
                  onChange={e => setProviderId(e.target.value)}
                  className="rounded-xl border border-white/[0.08] bg-[#161616] px-3 py-2 text-xs text-white outline-none focus:border-white/30"
                >
                  {choices.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>

                <input
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  onChange={e => setKey(e.target.value)}
                  placeholder="API Key"
                  required
                  className="rounded-xl border border-white/[0.08] bg-[#161616] px-3 py-2 text-xs text-white placeholder:text-neutral-500 outline-none focus:border-white/30"
                />

                {providerId === 'custom' && (
                  <>
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Display Name"
                      required
                      className="rounded-xl border border-white/[0.08] bg-[#161616] px-3 py-2 text-xs text-white placeholder:text-neutral-500 outline-none focus:border-white/30"
                    />
                    <input
                      type="url"
                      value={baseUrl}
                      onChange={e => setBaseUrl(e.target.value)}
                      placeholder="Base URL: https://integrate.api.nvidia.com/v1"
                      required
                      className="rounded-xl border border-white/[0.08] bg-[#161616] px-3 py-2 text-xs text-white placeholder:text-neutral-500 outline-none focus:border-white/30"
                    />
                    <input
                      value={customModel}
                      onChange={e => setCustomModel(e.target.value)}
                      placeholder="Model ID: moonshotai/kimi-k3"
                      required
                      className="sm:col-span-2 rounded-xl border border-white/[0.08] bg-[#161616] px-3 py-2 text-xs text-white placeholder:text-neutral-500 outline-none focus:border-white/30"
                    />
                  </>
                )}
              </div>
              {providerId === 'custom' && (
                <p className="text-[11px] text-neutral-400">
                  Tip: Base URL must be the root or /v1 path (omit <code>/chat/completions</code>).
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy === 'connect'}
                  className="rounded-lg bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-neutral-200 transition-colors disabled:opacity-50"
                >
                  {busy === 'connect' ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </motion.form>
          )}
        </div>
      </div>

      <VoiceAgentSettings providers={snapshot.providers} models={snapshot.models} />
      <section aria-label="Image generation settings" className="space-y-4 rounded-2xl border border-white/10 bg-[#141414] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-white">Image generation</h3>
        <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-xs text-neutral-400"><span>Provider</span><select aria-label="Image provider" value={imageConnectionId} onChange={event => { void savePreferences({ image_model_id: imageModels.find(model => model.connection_id === event.target.value)?.id || null }); }} className="w-full min-w-0 rounded-xl border border-white/10 bg-[#202020] px-3 py-2.5 text-xs text-white"><option value="">Automatic</option>{snapshot.providers.filter(connection => imageModels.some(model => model.connection_id === connection.id)).map(connection => <option key={connection.id} value={connection.id}>{connection.display_name}</option>)}</select></label>
          <label className="space-y-2 text-xs text-neutral-400"><span>Model</span><select aria-label="Image model" value={selectedImage?.id || ''} onChange={event => void savePreferences({ image_model_id: event.target.value || null })} className="w-full min-w-0 rounded-xl border border-white/10 bg-[#202020] px-3 py-2.5 text-xs text-white"><option value="">Automatic</option>{imageModels.filter(model => !imageConnectionId || model.connection_id === imageConnectionId).map(model => <option key={model.id} value={model.id}>{model.display_name}</option>)}</select></label></div>
        {!imageModels.length && <p className="text-[11px] leading-5 text-neutral-500">No image model connected. Add an image-capable provider key above.</p>}
      </section>
      {/* ── Floating Notification Toast ─────────────────────────────────── */}
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border border-white/[0.12] bg-[#1c1c1c]/95 px-4 py-2 text-xs font-medium text-white shadow-2xl backdrop-blur-md"
          >
            <span>{notice}</span>
            <button
              onClick={() => setNotice('')}
              className="ml-1 text-neutral-400 hover:text-white transition-colors"
            >
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
  );
}
