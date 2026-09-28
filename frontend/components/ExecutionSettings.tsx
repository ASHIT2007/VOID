'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown, KeyRound, Loader2, Plus, RotateCcw, Route, Workflow, X } from 'lucide-react';
import { parseExecutionConfig, type ExecutionConfig, type ExecutionRole } from '@void/shared/execution-config.mjs';
import ProviderLogo, { providerBrand } from './ProviderLogo';
import type { Connection, Model } from './ProviderSettings';

const roleLabels: Record<ExecutionRole['kind'], string> = {
  researcher: 'Researcher', analyst: 'Analyst', fact_checker: 'Fact checker', answer_writer: 'Answer writer', custom: 'Custom role',
};
const field = 'w-full min-w-0 rounded-xl border border-white/10 bg-[#202020] px-3 py-3 text-xs text-white outline-none transition-colors focus-visible:border-white/50 disabled:opacity-50';
const iconButton = 'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-20';
const panel = 'rounded-2xl border border-white/[.08] bg-[#161616]';

export default function ExecutionSettings({ view, config, models, providers, save, onConnect }: {
  view: 'orchestration' | 'routing'; config: ExecutionConfig; models: Model[]; providers: Connection[];
  save: (config: ExecutionConfig) => Promise<void>; onConnect: () => void;
}) {
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fallbackId, setFallbackId] = useState('');
  const previousConfig = useRef(config);
  const reduced = useReducedMotion();
  const flowId = useId().replace(/:/g, '');
  const transition = { duration: reduced ? 0 : .2, ease: 'easeOut' as const };

  // Refreshes must not discard a draft. Saving is locked until its response arrives.
  useEffect(() => {
    const previous = previousConfig.current;
    setDraft(current => JSON.stringify(current) === JSON.stringify(previous) ? config : current);
    previousConfig.current = config;
  }, [config]);

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
    <div className="relative min-w-0">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">{logo(id, 16)}</span>
      <select aria-label={name} value={id || ''} onChange={event => change(event.target.value)} className={`${field} appearance-none pl-10 pr-9`}>
        <option value="" disabled>Choose a connected model</option>
        {id && !model(id) && <option value={id} disabled>Model unavailable · choose another</option>}
        {providers.filter(connection => models.some(item => item.connection_id === connection.id)).map(connection => (
          <optgroup key={connection.id} label={connection.display_name}>
            {models.filter(item => item.connection_id === connection.id).map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}
          </optgroup>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500" size={14} />
    </div>
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
  const updateRole = (id: string, values: Partial<ExecutionRole>) => update({ roles: draft.roles.map(role => role.id === id ? { ...role, ...values } : role) });
  const moveRole = (index: number, offset: number) => {
    const next = [...stages]; [next[index], next[index + offset]] = [next[index + offset], next[index]];
    update({ roles: [...next, ...(writer ? [writer] : [])] });
  };
  const addRole = () => {
    const id = crypto.randomUUID();
    update({ roles: [...stages, { id, kind: 'researcher', name: 'Researcher', modelId: draft.primaryModelId!, instruction: '' }, ...(writer ? [writer] : [])] });
    setExpanded(id);
  };
  const moveFallback = (index: number, offset: number) => {
    const ids = [...draft.fallbackModelIds]; [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    update({ fallbackModelIds: ids });
  };
  const nodes = draft.roles.length ? [
    { id: 'primary', name: 'Primary', modelId: draft.primaryModelId }, ...stages,
    writer || { id: 'writer', name: 'Answer writer', modelId: draft.primaryModelId },
  ] : [{ id: 'primary', name: 'Primary model', modelId: draft.primaryModelId }];
  const point = (angle: number) => ({ x: 240 + 151 * Math.cos(angle), y: 205 + 151 * Math.sin(angle) });

  return <div className="space-y-6 text-neutral-100">
    <header className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">{view === 'orchestration' ? <Workflow size={20} className="text-neutral-400" /> : <Route size={20} className="text-neutral-400" />}<h3 className="text-lg font-semibold tracking-tight">{view === 'orchestration' ? 'Orchestration' : 'Routing'}</h3></div>
      <button onClick={onConnect} aria-label="Connect provider" title="Connect provider" className={iconButton}><KeyRound size={17} /></button>
    </header>

    <fieldset disabled={saving} className="min-w-0 space-y-5">
      <section className={`${panel} p-4 sm:p-5`}>
        <p className="mb-3 text-xs font-medium text-neutral-400">Primary</p>
        {selectModel(draft.primaryModelId, primaryModelId => update({ primaryModelId, fallbackModelIds: draft.fallbackModelIds.filter(id => id !== primaryModelId) }), 'Primary model')}
        {!models.length && <button onClick={onConnect} className="mt-3 rounded-lg bg-white px-4 py-2.5 text-xs font-semibold text-black">Connect provider</button>}
      </section>

      <motion.div key={view} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="space-y-5">
        {view === 'orchestration' ? <>
          <section aria-label="Orchestration flow" className={`${panel} overflow-hidden`}>
            <div className="flex items-center justify-between px-5 pt-4 text-[10px] text-neutral-500"><Workflow size={14} aria-hidden="true" /><span>{dirty ? 'Draft' : ''}</span></div>
            <svg viewBox={nodes.length === 1 ? '0 0 480 260' : '0 0 480 420'} role="img" aria-label={nodes.map(node => `${node.name}: ${label(node.modelId)}`).join(' → ')} className="mx-auto block w-full max-w-[480px]">
              <defs><marker id={`${flowId}-arrow`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0L5 2.5L0 5" fill="#737373" /></marker></defs>
              {nodes.length > 1 && <>
                <circle cx="240" cy="205" r="151" fill="none" stroke="#ffffff" strokeOpacity=".035" strokeWidth="1" />
                <text x="240" y="211" textAnchor="middle" fill="#616161" fontSize="22" fontWeight="300">{String(stages.length + 1).padStart(2, '0')}</text>
                {nodes.slice(0, -1).map((node, index) => {
                  const startAngle = -Math.PI / 2 + index * Math.PI * 2 / nodes.length + .27;
                  const endAngle = -Math.PI / 2 + (index + 1) * Math.PI * 2 / nodes.length - .29;
                  const start = point(startAngle), end = point(endAngle);
                  const path = `M${start.x},${start.y} A151,151 0 0 1 ${end.x},${end.y}`;
                  return <g key={node.id}><path d={path} fill="none" stroke="#454545" strokeWidth="1.25" markerEnd={`url(#${flowId}-arrow)`} />{!reduced && <circle r="2" fill="#bdbdbd"><animateMotion dur="3.5s" begin={`${index * .4}s`} repeatCount="indefinite" path={path} /></circle>}</g>;
                })}
              </>}
              {nodes.map((node, index) => {
                const position = nodes.length === 1 ? { x: 240, y: 92 } : point(-Math.PI / 2 + index * Math.PI * 2 / nodes.length);
                const connection = provider(node.modelId);
                const brand = connection && providerBrand(connection.provider_id, connection.display_name, connection.base_url || '');
                return <g key={node.id} transform={`translate(${position.x},${position.y})`}>
                  <title>{node.name} · {label(node.modelId)}</title>
                  {index === 0 && <circle r="32" fill="none" stroke="white" strokeOpacity=".1" strokeWidth="5" />}
                  <circle r="27" fill="#232323" stroke={index === 0 ? '#fff' : '#535353'} strokeWidth={index === 0 ? 2.5 : 1} />
                  {brand ? <image href={`/provider-logos/${brand}.svg`} x="-12" y="-12" width="24" height="24" style={{ filter: 'brightness(0) invert(1)' }} /> : <text textAnchor="middle" y="5" fill="#ccc" fontSize="13">{connection?.display_name.slice(0, 2).toUpperCase() || '+'}</text>}
                  <rect x="-56" y="33" width="112" height="34" rx="6" fill="#161616" />
                  <text textAnchor="middle" y="46" fill="#d4d4d4" fontSize="11" fontWeight="500">{node.name.length > 18 ? `${node.name.slice(0, 16)}…` : node.name}</text>
                  <text textAnchor="middle" y="61" fill="#737373" fontSize="9">{label(node.modelId).length > 23 ? `${label(node.modelId).slice(0, 21)}…` : label(node.modelId)}</text>
                </g>;
              })}
              {nodes.length === 1 && <text x="240" y="210" textAnchor="middle" fill="#737373" fontSize="12">All roles</text>}
            </svg>
          </section>

          <div className="flex items-center justify-between"><h4 className="text-xs font-medium text-neutral-400">Roles</h4><span className="text-[10px] text-neutral-500">{draft.roles.length} / 6</span></div>
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {orderedRoles.map((role, index) => {
                const open = expanded === role.id;
                const final = role.kind === 'answer_writer';
                return <motion.section layout={!reduced ? 'position' : false} key={role.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={transition} className={panel}>
                  <div className="flex items-center gap-1 p-2 sm:gap-2 sm:p-3">
                    <button aria-expanded={open} aria-controls={`${flowId}-${role.id}`} onClick={() => setExpanded(open ? null : role.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left focus-visible:outline focus-visible:outline-white">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 text-xs text-neutral-400">{final ? <Check size={15} /> : String(index + 1).padStart(2, '0')}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{role.name || 'Custom role'}</span><span className="mt-1 block truncate text-[11px] text-neutral-500">{label(role.modelId)}{final ? ' · final answer' : ''}</span></span>
                      <ChevronDown size={14} className={`shrink-0 text-neutral-500 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {!final && <div className="flex"><button disabled={index === 0} title="Move earlier" aria-label={`Move ${role.name} earlier`} onClick={() => moveRole(index, -1)} className={iconButton}><ArrowUp size={14} /></button><button disabled={index === stages.length - 1} title="Move later" aria-label={`Move ${role.name} later`} onClick={() => moveRole(index, 1)} className={iconButton}><ArrowDown size={14} /></button></div>}
                    <button title="Remove role" aria-label={`Remove ${role.name}`} onClick={() => update({ roles: draft.roles.filter(item => item.id !== role.id) })} className={iconButton}><X size={14} /></button>
                  </div>
                  <motion.div id={`${flowId}-${role.id}`} initial={false} animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }} transition={transition} inert={!open} className="overflow-hidden">
                    <div className="space-y-3 border-t border-white/5 p-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block space-y-2 text-xs text-neutral-400"><span>Role</span><select aria-label={`Role ${index + 1}`} value={role.kind} className={field} onChange={event => { const kind = event.target.value as ExecutionRole['kind']; updateRole(role.id, { kind, name: roleLabels[kind] }); }}>{Object.entries(roleLabels).filter(([kind]) => kind !== 'answer_writer' || !writer || writer.id === role.id).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select></label>
                        <label className="block space-y-2 text-xs text-neutral-400"><span>Assigned model</span>{selectModel(role.modelId, modelId => updateRole(role.id, { modelId }), `Model for ${role.name}`)}</label>
                      </div>
                      {role.kind === 'custom' && <label className="block space-y-2 text-xs text-neutral-400"><span>Role name</span><input aria-label="Custom role name" maxLength={60} className={field} value={role.name} onChange={event => updateRole(role.id, { name: event.target.value })} /></label>}
                      <label className="block space-y-2 text-xs text-neutral-400"><span>Instructions {role.kind === 'custom' ? '(required)' : '(optional)'}</span><textarea aria-label={`Instructions for ${role.name}`} placeholder={role.kind === 'custom' ? 'Describe what this specialist should do…' : 'Add a focus, constraint or review criteria…'} maxLength={600} rows={3} className={`${field} resize-y`} value={role.instruction} onChange={event => updateRole(role.id, { instruction: event.target.value })} /></label>
                    </div>
                  </motion.div>
                </motion.section>;
              })}
            </AnimatePresence>
            {!writer && <div className="flex items-center gap-3 px-4 py-3 text-xs text-neutral-500" title="Your primary model writes the final answer"><Check size={14} /><span>Answer writer</span><span className="ml-auto truncate">{label(draft.primaryModelId)}</span></div>}
            <button disabled={!model(draft.primaryModelId) || draft.roles.length >= 6} onClick={addRole} aria-label="Add role" title="Add role" className="flex w-full items-center justify-center rounded-xl border border-dashed border-white/20 py-3 text-neutral-300 transition-colors hover:border-white/40 hover:bg-white/5 disabled:opacity-30"><Plus size={18} /></button>
          </div>
        </> : <>
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
          <div className="flex flex-col gap-2 sm:flex-row">
            <select aria-label="Add fallback model" value={candidates.some(item => item.id === fallbackId) ? fallbackId : ''} onChange={event => setFallbackId(event.target.value)} className={field}><option value="">{candidates.length ? 'Choose another connected model' : 'No additional models available'}</option>{candidates.map(item => <option key={item.id} value={item.id}>{item.display_name} · {providers.find(connection => connection.id === item.connection_id)?.display_name}</option>)}</select>
            <button disabled={!candidates.some(item => item.id === fallbackId) || !model(draft.primaryModelId) || draft.fallbackModelIds.length >= 8} onClick={() => { update({ fallbackModelIds: [...draft.fallbackModelIds, fallbackId] }); setFallbackId(''); }} aria-label="Add fallback model" title="Add fallback model" className="inline-flex shrink-0 items-center justify-center rounded-xl border border-white/15 px-4 py-3 transition-colors hover:bg-white/5 disabled:opacity-30"><Plus size={18} /></button>
          </div>
        </>}
      </motion.div>

    </fieldset>

    <div className="border-t border-white/10 pt-4">
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
