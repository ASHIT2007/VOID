'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowRight, ArrowUp, Check, KeyRound, Loader2, Plus, RotateCcw, Route, Workflow, X } from 'lucide-react';
import { parseExecutionConfig, type ExecutionConfig } from '@void/shared/execution-config.mjs';
import ProviderLogo from './ProviderLogo';
import OrchestrationTree from './OrchestrationTree';
import VoidSelect from './ui/VoidSelect';
import type { Connection, Model } from './ProviderSettings';

const field = 'text-white';
const iconButton = 'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-20';
const panel = 'rounded-2xl border border-white/[.08] bg-[#161616]';

export default function ExecutionSettings({ view, config, models, providers, save, onConnect, active = true, checkHealth }: {
  view: 'orchestration' | 'routing'; config: ExecutionConfig; models: Model[]; providers: Connection[];
  save: (config: ExecutionConfig) => Promise<void>; onConnect: () => void;
  active?: boolean; checkHealth?: (ids: string[], signal: AbortSignal) => Promise<void>;
}) {
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [fallbackId, setFallbackId] = useState('');
  const [healthError, setHealthError] = useState('');
  const previousConfig = useRef(config);
  const reduced = useReducedMotion();
  const transition = { duration: reduced ? 0 : .2, ease: 'easeOut' as const };

  // Refreshes must not discard a draft. Saving is locked until its response arrives.
  useEffect(() => {
    const previous = previousConfig.current;
    setDraft(current => JSON.stringify(current) === JSON.stringify(previous) ? config : current);
    previousConfig.current = config;
  }, [config]);

  const assignedIds = [...new Set([draft.primaryModelId, ...draft.roles.map(role => role.modelId), ...draft.fallbackModelIds].filter((id): id is string => Boolean(id)))].sort().join(',');
  const availableIds = models.map(model => model.id).sort().join(',');
  const healthController = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!active || !checkHealth) return;
    const controller = new AbortController();
    healthController.current = controller;
    let pending = false;
    const refresh = async () => {
      if (document.hidden || pending) return;
      const eligible = new Set(availableIds.split(','));
      const ids = assignedIds.split(',').filter(id => id && eligible.has(id));
      if (!ids.length) return;
      pending = true;
      try { await checkHealth(ids, controller.signal); if (!controller.signal.aborted) setHealthError(''); }
      catch (error) { if (!controller.signal.aborted) setHealthError(error instanceof Error ? error.message : 'Could not check availability.'); }
      finally { pending = false; }
    };
    const initial = window.setTimeout(() => void refresh(), 350);
    const timer = window.setInterval(() => void refresh(), 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); clearTimeout(initial); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [active, assignedIds, availableIds, checkHealth]);
  const retryHealth = () => {
    const signal = healthController.current?.signal;
    if (!checkHealth || !signal || signal.aborted) return;
    void checkHealth(assignedIds.split(',').filter(id => models.some(model => model.id === id)), signal)
      .then(() => setHealthError('')).catch(error => { if (!signal.aborted) setHealthError(error.message); });
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const update = (values: Partial<ExecutionConfig>) => {
    setDraft(current => ({ ...current, ...values })); setSaved(false); setError('');
  };
  const model = (id: string | null) => models.find(item => item.id === id);
  const provider = (id: string | null) => providers.find(item => item.id === model(id)?.connection_id);
  const label = (id: string | null) => model(id)?.display_name || (id ? 'Model unavailable' : 'Choose a model');
  const logo = (id: string | null, size = 20) => {
    const connection = provider(id);
    return connection ? <ProviderLogo providerId={connection.provider_id} name={connection.display_name} baseUrl={connection.base_url} size={size} /> : <Plus size={size} className="text-neutral-500" />;
  };
  const selectModel = (id: string | null, change: (id: string) => void, name: string) => (
    <VoidSelect aria-label={name} value={id || ''} onChange={event => change(event.target.value)} leading={logo(id, 16)} className="text-white">
      <option value="" disabled>Choose a connected model</option>
      {id && !model(id) && <option value={id} disabled>Model unavailable · choose another</option>}
      {providers.filter(connection => models.some(item => item.connection_id === connection.id)).map(connection => (
        <optgroup key={connection.id} label={connection.display_name}>
          {models.filter(item => item.connection_id === connection.id).map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}
        </optgroup>
      ))}
    </VoidSelect>
  );
  const stages = draft.roles.filter(role => role.kind !== 'answer_writer');
  const writer = draft.roles.find(role => role.kind === 'answer_writer');
  const orderedRoles = [...stages, ...(writer ? [writer] : [])];
  const candidates = models.filter(item => item.id !== draft.primaryModelId && !draft.fallbackModelIds.includes(item.id));
  const unavailable = [draft.primaryModelId, ...draft.fallbackModelIds, ...draft.roles.map(role => role.modelId)].some(id => id && !model(id));
  const commit = async () => {
    setError('');
    try {
      const next = parseExecutionConfig({ ...draft, roles: orderedRoles });
      if (!next.primaryModelId || unavailable) throw new Error('Choose an enabled model for every assignment before saving.');
      setSaving(true);
      await save(next); setDraft(next); setSaved(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save settings. Please retry.'); }
    finally { setSaving(false); }
  };
  const moveFallback = (index: number, offset: number) => {
    const ids = [...draft.fallbackModelIds]; [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    update({ fallbackModelIds: ids });
  };
  return <div className="space-y-6 text-neutral-100">
    <header className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">{view === 'orchestration' ? <Workflow size={20} className="text-neutral-400" /> : <Route size={20} className="text-neutral-400" />}<h3 className="text-lg font-semibold tracking-tight">{view === 'orchestration' ? 'Orchestration' : 'Routing'}</h3></div>
      <button onClick={onConnect} aria-label="Connect provider" title="Connect provider" className={iconButton}><KeyRound size={17} /></button>
    </header>

    <fieldset disabled={saving} className="min-w-0 space-y-5">
      {view === 'routing' && <section className={`${panel} p-4 sm:p-5`}>
        <p className="mb-3 text-xs font-medium text-neutral-400">Primary</p>
        {selectModel(draft.primaryModelId, primaryModelId => update({ primaryModelId, fallbackModelIds: draft.fallbackModelIds.filter(id => id !== primaryModelId) }), 'Primary model')}
        {!models.length && <button onClick={onConnect} className="mt-3 rounded-lg bg-white px-4 py-2.5 text-xs font-semibold text-black">Connect provider</button>}
      </section>}

      <motion.div key={view} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="space-y-5">
        {view === 'orchestration' ? <OrchestrationTree config={draft} models={models} providers={providers} onChange={update} onConnect={onConnect} disabled={saving} onCheckHealth={checkHealth ? retryHealth : undefined} /> : <>
          <section className={`${panel} overflow-hidden p-5`}>
            <div className="flex items-center justify-between text-[10px] text-neutral-500"><Route size={14} aria-hidden="true" /><span>{dirty ? 'Draft' : ''}</span></div>
            <div tabIndex={0} className="mt-6 flex gap-2 overflow-x-auto pb-4 focus-visible:outline focus-visible:outline-white" aria-label="Model routing sequence">
              {[draft.primaryModelId, ...draft.fallbackModelIds].map((id, index) => <div key={id || 'empty'} className="flex shrink-0 items-center gap-2">
                <motion.div layout={!reduced ? 'position' : false} initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="w-28 text-center">
                  <div className={`mx-auto flex size-14 items-center justify-center rounded-full bg-[#232323] ${index === 0 ? 'border-[2.5px] border-white ring-4 ring-white/5' : 'border border-white/20'}`}>{logo(id, 24)}</div>
                  <p className="mt-4 text-[10px] font-medium uppercase tracking-wider text-neutral-500">{index ? `Fallback ${index}` : 'Primary'}</p><p title={label(id)} className="mt-1 truncate text-xs text-neutral-200">{label(id)}</p>
                </motion.div>
                {index < draft.fallbackModelIds.length && <motion.span className="mb-9 text-neutral-500" animate={reduced ? {} : { opacity: [.3, 1, .3] }} transition={{ duration: 2.5, repeat: Infinity, delay: index * .4 }}><ArrowRight size={18} /></motion.span>}
              </div>)}
            </div>
          </section>
          <h4 className="text-xs font-medium text-neutral-400">Fallbacks</h4>
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {draft.fallbackModelIds.map((id, index) => <motion.div layout={!reduced ? 'position' : false} key={id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={transition} className={`${panel} flex min-w-0 items-center gap-2 p-3 sm:gap-3`}>
                <span className="w-4 shrink-0 text-xs text-neutral-500">{String(index + 1).padStart(2, '0')}</span><span className="hidden sm:block">{logo(id, 20)}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{label(id)}</p><p className="mt-1 truncate text-[11px] text-neutral-500">{provider(id)?.display_name}{provider(id)?.id === provider(draft.primaryModelId)?.id ? ' · shared key' : ''}</p></div>
                <div className="flex"><button disabled={!index} title="Move earlier" aria-label={`Move fallback ${index + 1} earlier`} onClick={() => moveFallback(index, -1)} className={iconButton}><ArrowUp size={14} /></button><button disabled={index === draft.fallbackModelIds.length - 1} title="Move later" aria-label={`Move fallback ${index + 1} later`} onClick={() => moveFallback(index, 1)} className={iconButton}><ArrowDown size={14} /></button><button title="Remove fallback" aria-label={`Remove fallback ${index + 1}`} onClick={() => update({ fallbackModelIds: draft.fallbackModelIds.filter(value => value !== id) })} className={iconButton}><X size={14} /></button></div>
              </motion.div>)}
            </AnimatePresence>
            {!draft.fallbackModelIds.length && <div className="px-1 text-xs text-neutral-500">Primary only</div>}
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <VoidSelect aria-label="Fallback model" value={candidates.some(item => item.id === fallbackId) ? fallbackId : ''} onChange={event => setFallbackId(event.target.value)} className={field}><option value="">{candidates.length ? 'Choose another connected model' : 'No additional models available'}</option>{candidates.map(item => <option key={item.id} value={item.id}>{item.display_name} · {providers.find(connection => connection.id === item.connection_id)?.display_name}</option>)}</VoidSelect>
            <button disabled={!candidates.some(item => item.id === fallbackId) || !model(draft.primaryModelId) || draft.fallbackModelIds.length >= 8} onClick={() => { update({ fallbackModelIds: [...draft.fallbackModelIds, fallbackId] }); setFallbackId(''); }} aria-label="Add fallback model" title="Add fallback model" className="inline-flex shrink-0 items-center justify-center rounded-xl border border-white/15 px-4 py-3 transition-colors hover:bg-white/5 disabled:opacity-30"><Plus size={18} /></button>
          </div>
        </>}
      </motion.div>

    </fieldset>

    <div className="border-t border-white/10 pt-4">
      {healthError && <p role="status" className="mb-3 text-xs text-neutral-400">{healthError}</p>}
      {(error || unavailable) && <p role="alert" className="mb-3 text-xs leading-5 text-neutral-200">{error || 'An assigned model is disabled or disconnected. Replace or remove that assignment to save.'}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-neutral-400" role="status" aria-live="polite">{saving ? 'Saving…' : dirty ? 'Unsaved' : saved ? 'Saved' : ''}</span>
        <div className="flex items-center gap-2">
          {dirty && <button disabled={saving} onClick={() => { setDraft(config); setError(''); setSaved(false); }} className={iconButton} aria-label="Discard changes" title="Discard changes"><RotateCcw size={15} /></button>}
          <button disabled={saving || !dirty || !models.length} onClick={() => void commit()} aria-label="Save changes" title="Save changes" className="inline-flex size-10 items-center justify-center rounded-xl bg-white text-black transition-colors hover:bg-neutral-200 disabled:opacity-40">{saving ? <Loader2 size={17} className="animate-spin motion-reduce:animate-none" /> : <Check size={17} />}</button>
        </div>
      </div>
    </div>
  </div>;
}
