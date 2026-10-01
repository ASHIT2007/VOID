'use client';

import { useId, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowUp, Check, ChevronRight, GripVertical, Loader2, MessageSquare, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Workflow, X } from 'lucide-react';
import type { ExecutionConfig, ExecutionRole } from '@void/shared/execution-config.mjs';
import type { Connection, Model } from './ProviderSettings';
import ProviderLogo from './ProviderLogo';
import VoidSelect from './ui/VoidSelect';

const roles: Record<ExecutionRole['kind'], string> = { researcher: 'Researcher', analyst: 'Analyst', fact_checker: 'Fact checker', answer_writer: 'Answer writer', custom: 'Custom role' };
const descriptions: Record<ExecutionRole['kind'], string> = { researcher: 'Gather context and evidence', analyst: 'Connect findings and reason', fact_checker: 'Verify claims and assumptions', answer_writer: 'Compose the final response', custom: 'Define your own specialist' };
const field = 'w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2.5 text-xs text-white outline-none focus-visible:border-white/40';
const iconButton = 'flex size-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-25';
const roleIcons = { researcher: Search, analyst: Sparkles, fact_checker: ShieldCheck, answer_writer: Check, custom: Workflow };
const healthLabel = (status?: Model['runtime_status']) => status === 'rate_limited' ? 'Rate limited' : status === 'unavailable' ? 'Not responding' : status === 'checking' ? 'Checking availability' : status === 'healthy' ? 'Available' : 'Availability not yet checked';

export default function OrchestrationTree({ config, models, providers, onChange, onConnect, disabled, dirty, onCheckHealth }: {
  config: ExecutionConfig; models: Model[]; providers: Connection[]; onChange: (values: Partial<ExecutionConfig>) => void; onConnect: () => void; disabled: boolean; dirty: boolean;
  onCheckHealth?: () => void;
}) {
  const [selectedId, setSelectedId] = useState('primary');
  const [armed, setArmed] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showInstructions, setShowInstructions] = useState(false);
  const [ghost, setGhost] = useState<{ providerId: string; x: number; y: number } | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const editor = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const flowId = useId().replace(/:/g, '');
  const stages = config.roles.filter(role => role.kind !== 'answer_writer');
  const writer = config.roles.find(role => role.kind === 'answer_writer');
  const connected = providers.filter(provider => models.some(model => model.connection_id === provider.id));
  const selectedRole = config.roles.find(role => role.id === selectedId);
  const selected = selectedId === 'primary' || (!selectedRole && selectedId !== 'writer')
    ? { id: 'primary', name: 'Primary', modelId: config.primaryModelId }
    : selectedRole ?? { id: 'writer', name: 'Answer writer', modelId: config.primaryModelId };
  const selectedModel = models.find(model => model.id === selected.modelId);
  const selectedProvider = providers.find(provider => provider.id === selectedModel?.connection_id);
  const transition = { duration: reduced ? 0 : .25 };

  const updateRole = (id: string, values: Partial<ExecutionRole>) => onChange({ roles: config.roles.map(role => role.id === id ? { ...role, ...values } : role) });
  const assign = (id: string, modelId: string) => {
    if (disabled) return;
    if (id === 'primary') onChange({ primaryModelId: modelId, fallbackModelIds: config.fallbackModelIds.filter(value => value !== modelId) });
    else if (id === 'writer' && !writer) {
      if (config.roles.length >= 6) { setAnnouncement('Remove a specialist to assign a separate answer writer. You can use up to six roles.'); return; }
      const roleId = crypto.randomUUID();
      onChange({ roles: [...config.roles, { id: roleId, kind: 'answer_writer', name: 'Answer writer', modelId, instruction: '' }] });
      setSelectedId(roleId);
    } else updateRole(id, { modelId });
  };
  const assignProvider = (id: string, providerId: string) => {
    const current = id === 'primary' ? config.primaryModelId : id === 'writer' ? config.primaryModelId : config.roles.find(role => role.id === id)?.modelId;
    const candidates = models.filter(model => model.connection_id === providerId);
    const next = candidates.find(model => model.id === current) ?? candidates[0];
    if (!next) return;
    setSelectedId(id); assign(id, next.id); setArmed(null); setDragging(null); setOver(null);
    setAnnouncement(`${providers.find(provider => provider.id === providerId)?.display_name} assigned. Choose a model in the node editor.`);
  };
  const addRole = () => {
    if (!config.primaryModelId || config.roles.length >= 6) return;
    const kind = (['researcher', 'analyst', 'fact_checker'] as const).find(kind => !stages.some(role => role.kind === kind)) ?? 'researcher';
    const id = crypto.randomUUID();
    onChange({ roles: [...stages, { id, kind, name: roles[kind], modelId: config.primaryModelId, instruction: '' }, ...(writer ? [writer] : [])] });
    setSelectedId(id);
  };
  const move = (offset: number) => {
    const index = stages.findIndex(role => role.id === selected.id);
    if (index < 0 || index + offset < 0 || index + offset >= stages.length) return;
    const next = [...stages]; [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange({ roles: [...next, ...(writer ? [writer] : [])] });
  };
  const nodeAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-orchestration-node]')?.dataset.orchestrationNode ?? null;
  const dragProvider = (event: PointerEvent<HTMLButtonElement>, providerId: string) => {
    if (!pointerStart.current || disabled) return;
    if (!didDrag.current && Math.hypot(event.clientX - pointerStart.current.x, event.clientY - pointerStart.current.y) < 6) return;
    didDrag.current = true;
    setDragging(providerId); setArmed(null);
    setGhost({ providerId, x: Math.max(8, Math.min(innerWidth - 56, event.clientX + 12)), y: Math.max(8, Math.min(innerHeight - 56, event.clientY + 12)) });
    setOver(nodeAt(event.clientX, event.clientY));
  };
  const node = (entry: { id: string; name: string; modelId: string | null }, step: string, subtitle: string) => {
    const model = models.find(model => model.id === entry.modelId);
    const provider = providers.find(provider => provider.id === model?.connection_id);
    const active = selected.id === entry.id;
    const unhealthy = Boolean(entry.modelId && !model) || model?.runtime_status === 'rate_limited' || model?.runtime_status === 'unavailable';
    const role = config.roles.find(role => role.id === entry.id);
    const RoleIcon = role ? roleIcons[role.kind] : entry.id === 'primary' ? Workflow : Check;
    return <motion.button type="button" disabled={disabled} layout={!reduced} aria-label={`Configure ${entry.name}: ${model?.display_name || 'Choose a model'}`} aria-pressed={active}
      title={`${entry.name} · ${provider?.display_name || 'Unassigned'} · ${model?.display_name || 'Choose a model'} · ${healthLabel(model?.runtime_status)}`} data-provider-status={unhealthy && !model ? 'unavailable' : model?.runtime_status || 'unknown'}
      data-orchestration-node={entry.id}
      onClick={() => { setSelectedId(entry.id); if (armed) assignProvider(entry.id, armed); else requestAnimationFrame(() => editor.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' })); }}
      whileHover={reduced || disabled ? undefined : { y: -2 }} whileTap={reduced ? undefined : { scale: .98 }} transition={transition}
      className={`orchestration-node relative z-10 flex w-full min-w-0 items-center gap-3 rounded-2xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${over === entry.id ? 'border-white bg-white/15 ring-4 ring-white/10' : active ? 'border-white/35 bg-[#282828] shadow-lg' : 'border-white/10 bg-[#1c1c1c] hover:border-white/25'} ${dragging || armed ? 'orchestration-drop-ready' : ''}`}>
      <motion.span key={entry.modelId} initial={reduced ? false : { opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} className={`orchestration-provider-icon flex size-11 shrink-0 items-center justify-center rounded-xl border bg-white/[.04] ${unhealthy ? 'border-red-500/80' : 'border-white/10'}`}>
        {provider ? <ProviderLogo providerId={provider.provider_id} name={provider.display_name} baseUrl={provider.base_url} size={22} /> : <Plus size={18} className="text-neutral-500" />}
      </motion.span>
      <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><RoleIcon size={11} className="shrink-0 text-neutral-500" /><span className="truncate text-[11px] font-medium text-neutral-200">{entry.name}</span></span><span className="mt-1 block truncate text-[10px] text-neutral-500">{model?.display_name || (entry.modelId ? 'Unavailable' : 'Select model')}</span><span className="sr-only">{over === entry.id ? 'Release to assign provider' : subtitle}{unhealthy ? ` · ${healthLabel(model?.runtime_status)}` : ''}</span></span>
      <span className="absolute right-3 top-2 text-[8px] tabular-nums text-neutral-600">{step}</span>
      {model?.runtime_checking || model?.runtime_status === 'checking' ? <Loader2 size={13} aria-label="Checking availability" className="shrink-0 animate-spin text-neutral-400 motion-reduce:animate-none" /> : <ChevronRight size={13} className={active ? 'text-neutral-300' : 'text-neutral-600'} />}
    </motion.button>;
  };
  const connector = (path: string, marker = false) => <>
    <path d={path} fill="none" stroke="#454545" strokeWidth="1.2" vectorEffect="non-scaling-stroke" markerEnd={marker ? `url(#${flowId}-arrow)` : undefined} />
  </>;

  return <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#161616]">
    <div className="border-b border-white/[.06] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3"><h4 className="text-[10px] font-medium text-neutral-500">Providers</h4><div className="flex items-center gap-1">{onCheckHealth && <button type="button" onClick={onCheckHealth} disabled={disabled || models.some(model => model.runtime_checking || model.runtime_status === 'checking')} aria-label="Check model availability" title="Check availability" className={iconButton}><RefreshCw size={14} className={models.some(model => model.runtime_checking || model.runtime_status === 'checking') ? 'animate-spin motion-reduce:animate-none' : ''} /></button>}<button type="button" onClick={onConnect} aria-label="Connect another provider" title="Connect provider" className={iconButton}><Plus size={16} /></button></div></div>
      <div className="mt-2 flex flex-wrap gap-2" aria-label="Drag a provider to any node">
        {connected.map(provider => <button key={provider.id} type="button" disabled={disabled} draggable={false} aria-pressed={armed === provider.id}
          aria-label={`Assign ${provider.display_name}`} title={`${provider.display_name} · drag to assign`} data-provider-status={models.some(model => model.connection_id === provider.id && model.runtime_status === 'rate_limited') ? 'rate_limited' : models.some(model => model.connection_id === provider.id && model.runtime_status === 'unavailable') ? 'unavailable' : 'healthy'}
          style={{ touchAction: 'none' }}
          onPointerDown={event => { if (disabled || event.button !== 0) return; pointerStart.current = { x: event.clientX, y: event.clientY }; didDrag.current = false; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => dragProvider(event, provider.id)}
          onPointerUp={event => { if (didDrag.current) { const target = nodeAt(event.clientX, event.clientY); if (target) assignProvider(target, provider.id); } pointerStart.current = null; setGhost(null); setDragging(null); setOver(null); }}
          onPointerCancel={() => { pointerStart.current = null; didDrag.current = false; setGhost(null); setDragging(null); setOver(null); }}
          onClick={() => { if (didDrag.current) { didDrag.current = false; return; } setArmed(armed === provider.id ? null : provider.id); }}
          className={`orchestration-provider-tile relative flex size-14 items-center justify-center rounded-2xl border transition-all hover:-translate-y-0.5 motion-reduce:transform-none active:cursor-grabbing ${armed === provider.id ? 'border-white/40 bg-white/10 text-white' : 'cursor-grab border-white/10 bg-white/[.025] text-neutral-300 hover:border-white/25'} ${dragging === provider.id ? 'opacity-40' : ''}`}>
          <span className="pointer-events-none"><ProviderLogo providerId={provider.provider_id} name={provider.display_name} baseUrl={provider.base_url} size={24} /></span><GripVertical size={9} className="pointer-events-none absolute bottom-1.5 right-1.5 text-neutral-600" />
        </button>)}
        {!connected.length && <button type="button" onClick={onConnect} className="rounded-xl border border-dashed border-white/20 px-4 py-3 text-xs text-neutral-400">Connect a provider to build your team</button>}
      </div>
      <p className={armed ? 'mt-2 text-[10px] text-neutral-400' : 'sr-only'}>{armed ? 'Select a node' : 'Drag or select providers to assign them. Providers and models can be reused.'}</p>
    </div>

    <div className="orchestration-canvas p-4 sm:p-6" aria-label="Orchestration flow">
      <div className="mb-5 flex items-center justify-between gap-2 text-[10px] text-neutral-500"><Workflow size={14} aria-label="Execution tree" /><span title={`${dirty ? 'Unsaved changes' : 'Configured'} · ${stages.length} specialists`} className="flex items-center gap-2 rounded-full border border-white/10 bg-[#161616] px-2.5 py-1"><span className={`size-1 rounded-full ${dirty ? 'bg-white' : 'bg-neutral-600'}`} />{String(stages.length).padStart(2, '0')}</span></div>
      <svg className="absolute h-0 w-0" aria-hidden="true"><defs><marker id={`${flowId}-arrow`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0L5 2.5L0 5" fill="#858585" /></marker></defs></svg>
      <div className="mx-auto max-w-[540px]">
        <div className="orchestration-root mx-auto max-w-64">{node({ id: 'primary', name: 'Primary', modelId: config.primaryModelId }, '01', 'Coordinates the team')}</div>
        <div className="orchestration-stem relative h-8"><svg width="100%" height="100%" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">{connector('M50 0 V32', true)}</svg></div>
        <AnimatePresence initial={false}>
          {stages.map((role, index) => <motion.div key={role.id} layout={!reduced ? 'position' : false} initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 112 }} exit={{ opacity: 0, height: 0 }} transition={transition} className="orchestration-stage relative grid grid-cols-[1fr_40px_1fr] items-center">
            <svg className="orchestration-branch pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 540 112" preserveAspectRatio="none" aria-hidden="true">{connector('M270 0 V112', true)}{connector(index % 2 === 0 ? 'M270 24 Q270 56 250 56' : 'M270 24 Q270 56 290 56', true)}<circle cx="270" cy="24" r="3" fill="#161616" stroke="#858585" /></svg>
            <svg className="orchestration-mobile-branch pointer-events-none absolute inset-0 hidden h-full w-12" viewBox="0 0 48 112" aria-hidden="true">{connector('M12 0 V112', true)}{connector('M12 24 Q12 56 46 56', true)}<circle cx="12" cy="24" r="3" fill="#161616" stroke="#858585" /></svg>
            <div className={`orchestration-stage-card min-w-0 ${index % 2 ? 'col-start-3' : 'col-start-1'}`}>{node(role, String(index + 2).padStart(2, '0'), descriptions[role.kind])}</div>
          </motion.div>)}
        </AnimatePresence>
        {!stages.length && <div className="orchestration-empty relative py-5"><div className="absolute inset-y-0 left-1/2 border-l border-dashed border-white/15" /><button type="button" title="Add specialist" aria-label="Add first specialist" onClick={addRole} disabled={disabled || !config.primaryModelId} className="relative mx-auto flex size-9 items-center justify-center rounded-xl border border-dashed border-white/20 bg-[#161616] text-neutral-500"><Plus size={15} /></button></div>}
        <div className="orchestration-stem relative h-8"><svg width="100%" height="100%" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">{connector('M50 0 V32', true)}</svg></div>
        <div className="orchestration-root mx-auto max-w-64">{node(writer ?? { id: 'writer', name: 'Answer writer', modelId: config.primaryModelId }, String(stages.length + 2).padStart(2, '0'), writer ? 'Synthesizes the final answer' : 'Uses the primary model')}</div>
      </div>
      <div className="mt-5 flex items-center justify-center gap-3 border-t border-white/[.06] pt-4"><p className="sr-only">Specialists run top to bottom, then write the answer.</p><button type="button" onClick={addRole} disabled={disabled || !config.primaryModelId || config.roles.length >= 6} aria-label="Add specialist" title={`Add specialist · ${config.roles.length}/6 roles`} className="flex size-9 items-center justify-center rounded-xl border border-white/15 bg-white/[.04] text-neutral-200 transition-colors hover:bg-white/10 disabled:opacity-30"><Plus size={15} /></button></div>
    </div>

    <motion.div ref={editor} key={selected.id} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="border-t border-white/[.08] bg-[#191919] p-4 sm:p-5" aria-label={`Edit ${selected.name}`}>
      <div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-xs font-medium">{selected.name}</h4>{selectedRole && <div className="flex items-center gap-1"><button type="button" onClick={() => setShowInstructions(!showInstructions)} className={iconButton} aria-label="Edit instructions" aria-expanded={showInstructions} title="Instructions"><MessageSquare size={14} /></button>{selectedRole.kind !== 'answer_writer' && <><button type="button" onClick={() => move(-1)} disabled={disabled || stages[0]?.id === selected.id} className={iconButton} aria-label={`Move ${selected.name} earlier`} title="Move earlier"><ArrowUp size={14} /></button><button type="button" onClick={() => move(1)} disabled={disabled || stages.at(-1)?.id === selected.id} className={iconButton} aria-label={`Move ${selected.name} later`} title="Move later"><ArrowDown size={14} /></button></>}<button type="button" onClick={() => { onChange({ roles: config.roles.filter(role => role.id !== selected.id) }); setSelectedId('primary'); }} disabled={disabled} className={iconButton} aria-label={`Remove ${selected.name}`} title="Remove role"><X size={14} /></button></div>}</div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="space-y-2 text-[11px] text-neutral-400"><span>Provider</span><VoidSelect aria-label={`Provider for ${selected.name}`} value={selectedProvider?.id ?? ''} onChange={event => assignProvider(selected.id, event.target.value)} disabled={disabled} className="text-white" options={[{ value: '', label: 'Choose a provider', disabled: true }, ...connected.map(provider => ({ value: provider.id, label: provider.display_name, icon: <ProviderLogo providerId={provider.provider_id} name={provider.display_name} baseUrl={provider.base_url} size={16} /> }))]} /></label>
        <label className="space-y-2 text-[11px] text-neutral-400"><span>Model</span><VoidSelect aria-label={`Model for ${selected.name}`} value={selected.modelId ?? ''} onChange={event => assign(selected.id, event.target.value)} disabled={disabled} className="text-white" options={[{ value: '', label: 'Choose a model', disabled: true }, ...(selected.modelId && !selectedModel ? [{ value: selected.modelId, label: 'Model unavailable', disabled: true }] : []), ...models.filter(model => !selectedProvider || model.connection_id === selectedProvider.id).map(model => ({ value: model.id, label: model.display_name }))]} /></label>
      </div>
      {selectedRole && <div className="mt-3 space-y-3"><label className="block space-y-2 text-[11px] text-neutral-400"><span>Role</span><VoidSelect value={selectedRole.kind} aria-label={`Role for ${selected.name}`} className="text-white" disabled={disabled} onChange={event => { const kind = event.target.value as ExecutionRole['kind']; updateRole(selected.id, { kind, name: roles[kind] }); }} options={Object.entries(roles).filter(([kind]) => kind !== 'answer_writer' || !writer || writer.id === selected.id).map(([value, label]) => ({ value, label, description: descriptions[value as ExecutionRole['kind']] }))} /></label>
        {selectedRole.kind === 'custom' && <label className="block space-y-2 text-[11px] text-neutral-400"><span>Role name</span><input aria-label="Custom role name" maxLength={60} value={selectedRole.name} onChange={event => updateRole(selected.id, { name: event.target.value })} className={field} /></label>}
        {(showInstructions || selectedRole.kind === 'custom') && <label className="block space-y-2 text-[11px] text-neutral-400"><span>Instructions {selectedRole.kind === 'custom' ? '*' : ''}</span><textarea rows={2} maxLength={600} value={selectedRole.instruction} aria-label={`Instructions for ${selected.name}`} onChange={event => updateRole(selected.id, { instruction: event.target.value })} placeholder="Instructions…" className={`${field} resize-y`} /></label>}
      </div>}
      {announcement.startsWith('Remove') && <p role="alert" className="mt-3 text-[11px] text-neutral-400">{announcement}</p>}
    </motion.div>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    {ghost && typeof document !== 'undefined' && createPortal(<motion.div aria-hidden="true" initial={false} animate={{ x: ghost.x, y: ghost.y }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 900, damping: 45 }} className="pointer-events-none fixed left-0 top-0 z-[10001] flex size-12 items-center justify-center rounded-2xl border border-white/30 bg-[#282828]/95 shadow-2xl backdrop-blur-xl">
      {(() => { const provider = providers.find(provider => provider.id === ghost.providerId); return provider && <ProviderLogo providerId={provider.provider_id} name={provider.display_name} baseUrl={provider.base_url} size={24} />; })()}
    </motion.div>, document.body)}
  </section>;
}
