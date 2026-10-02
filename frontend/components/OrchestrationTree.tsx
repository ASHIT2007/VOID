'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowUp, GripVertical, Loader2, MessageSquare, Plus, RefreshCw, X } from 'lucide-react';
import type { ExecutionConfig, ExecutionRole } from '@void/shared/execution-config.mjs';
import type { Connection, Model } from './ProviderSettings';
import ProviderLogo from './ProviderLogo';
import VoidSelect from './ui/VoidSelect';

const roles: Record<ExecutionRole['kind'], string> = { researcher: 'Researcher', analyst: 'Analyst', fact_checker: 'Fact checker', answer_writer: 'Answer writer', custom: 'Custom role' };
const descriptions: Record<ExecutionRole['kind'], string> = { researcher: 'Gather context and evidence', analyst: 'Connect findings and reason', fact_checker: 'Verify claims and assumptions', answer_writer: 'Compose the final response', custom: 'Define your own specialist' };
const field = 'w-full rounded-xl border border-white/10 bg-white/[.03] px-3 py-2.5 text-xs text-white outline-none focus-visible:border-white/40';
const iconButton = 'flex size-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-25';
const healthLabel = (status?: Model['runtime_status']) => status === 'rate_limited' ? 'Rate limited' : status === 'unavailable' ? 'Not responding' : status === 'checking' ? 'Checking availability' : status === 'healthy' ? 'Available' : 'Availability not yet checked';
type TeamNode = { id: string; name: string; modelId: string | null };

export default function OrchestrationTree({ config, models, providers, onChange, onConnect, disabled, onCheckHealth }: {
  config: ExecutionConfig; models: Model[]; providers: Connection[]; onChange: (values: Partial<ExecutionConfig>) => void; onConnect: () => void; disabled: boolean;
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
  const stages = config.roles.filter(role => role.kind !== 'answer_writer');
  const writer = config.roles.find(role => role.kind === 'answer_writer');
  // Keep the saved execution order; the writer occupies a lower position in the network.
  const surrounding: TeamNode[] = [...stages];
  surrounding.splice(Math.floor((stages.length + 1) / 2), 0, writer ?? { id: 'writer', name: 'Answer writer', modelId: config.primaryModelId });
  const network = surrounding.map((entry, index) => {
    const angle = (surrounding.length === 1 ? 90 : -90 + index * 360 / surrounding.length) * Math.PI / 180;
    return { entry, x: 50 + 35 * Math.cos(angle), y: 46 + 34 * Math.sin(angle) };
  });
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
  const node = (entry: TeamNode, subtitle: string) => {
    const model = models.find(model => model.id === entry.modelId);
    const provider = providers.find(provider => provider.id === model?.connection_id);
    const active = selected.id === entry.id;
    const unhealthy = Boolean(entry.modelId && !model) || model?.runtime_status === 'rate_limited' || model?.runtime_status === 'unavailable';
    const status = entry.modelId && !model ? 'Model unavailable' : healthLabel(model?.runtime_status);
    const role = config.roles.find(role => role.id === entry.id);
    return <motion.button type="button" disabled={disabled} aria-label={`Configure ${entry.name}: ${model?.display_name || 'Choose a model'} · ${status}`} aria-pressed={active}
      title={`${entry.name} · ${provider?.display_name || 'Unassigned'} · ${model?.display_name || 'Choose a model'} · ${status}`} data-provider-status={unhealthy && !model ? 'unavailable' : model?.runtime_status || 'unknown'}
      data-orchestration-node={entry.id}
      data-node-kind={entry.id === 'primary' ? 'primary' : role?.kind || 'answer_writer'}
      data-drop-target={over === entry.id ? 'true' : undefined}
      onClick={() => { setSelectedId(entry.id); if (armed) assignProvider(entry.id, armed); else requestAnimationFrame(() => editor.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' })); }}
      transition={transition}
      className="orchestration-node group text-center outline-none disabled:cursor-default">
      <motion.span key={entry.modelId} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} className={`orchestration-provider-icon ${dragging || armed ? 'orchestration-drop-ready' : ''}`}>
        <span className="orchestration-logo">{provider ? <ProviderLogo providerId={provider.provider_id} name={provider.display_name} baseUrl={provider.base_url} size={entry.id === 'primary' ? 36 : 27} /> : <Plus size={entry.id === 'primary' ? 26 : 20} className="text-neutral-500" />}</span>
        {(model?.runtime_checking || model?.runtime_status === 'checking') && <span className="orchestration-health-check"><Loader2 size={12} aria-label="Checking availability" className="animate-spin motion-reduce:animate-none" /></span>}
      </motion.span>
      <span className="orchestration-node-label">
        <span className="orchestration-role-name"><span>{entry.name}</span></span>
        <span className="orchestration-model-name">{model?.display_name || (entry.modelId ? 'Model unavailable' : 'Select model')}</span>
        <span className="sr-only">{provider?.display_name}{role ? ` · ${roles[role.kind]}` : ''} · {over === entry.id ? 'Release to assign provider' : subtitle}</span>
      </span>
    </motion.button>;
  };

  return <section className="orchestration-panel overflow-hidden rounded-2xl border border-white/10">
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
          className={`orchestration-provider-tile relative flex size-14 items-center justify-center rounded-2xl border transition-colors active:cursor-grabbing ${armed === provider.id ? 'border-white/40 bg-white/10 text-white' : 'cursor-grab border-white/10 bg-white/[.025] text-neutral-300 hover:border-white/25'} ${dragging === provider.id ? 'opacity-40' : ''}`}>
          <span className="pointer-events-none"><ProviderLogo providerId={provider.provider_id} name={provider.display_name} baseUrl={provider.base_url} size={24} /></span><GripVertical size={9} className="pointer-events-none absolute bottom-1.5 right-1.5 text-neutral-600" />
        </button>)}
        {!connected.length && <button type="button" onClick={onConnect} className="rounded-xl border border-dashed border-white/20 px-4 py-3 text-xs text-neutral-400">Connect a provider to build your team</button>}
      </div>
      <p className={armed ? 'mt-2 text-[10px] text-neutral-400' : 'sr-only'}>{armed ? 'Select a node' : 'Drag or select providers to assign them. Providers and models can be reused.'}</p>
    </div>

    <div className="orchestration-canvas px-3 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5" aria-label="Orchestration network">
      <div className="orchestration-network" data-node-count={network.length}>
        <svg className="orchestration-connections" viewBox="0 0 600 600" preserveAspectRatio="none" aria-hidden="true">
          {network.map(({ entry, x, y }) => <path key={entry.id} d={`M300 276 L${x * 6} ${y * 6}`} />)}
        </svg>
        <div className="orchestration-position orchestration-primary" style={{ left: '50%', top: '46%' }}>{node({ id: 'primary', name: 'Primary', modelId: config.primaryModelId }, 'Coordinates the team')}</div>
        <AnimatePresence initial={false}>
          {network.map(({ entry, x, y }) => <motion.div key={entry.id} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition} className="orchestration-position" style={{ left: `${x}%`, top: `${y}%` }}>
            {node(entry, entry.id === 'writer' ? 'Uses the primary model to write the answer' : descriptions[config.roles.find(role => role.id === entry.id)?.kind ?? 'answer_writer'])}
          </motion.div>)}
        </AnimatePresence>
      </div>
      <div className="flex justify-center pt-1"><p className="sr-only">Select a node to configure its role. Specialists execute in their saved order, followed by the answer writer.</p><button type="button" onClick={addRole} disabled={disabled || !config.primaryModelId || config.roles.length >= 6} aria-label="Add specialist" title={`Add specialist · ${config.roles.length}/6 roles`} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-30"><Plus size={16} /></button></div>
    </div>

    <motion.div ref={editor} key={selected.id} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={transition} className="border-t border-white/[.08] p-4 sm:p-5" aria-label={`Edit ${selected.name}`}>
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
