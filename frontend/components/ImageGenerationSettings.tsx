'use client';

import { useId, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ImagePlus } from 'lucide-react';
import type { Connection, Model } from './ProviderSettings';
import ProviderLogo from './ProviderLogo';
import VoidSelect from './ui/VoidSelect';

export default function ImageGenerationSettings({ providers, models, modelId, onChange }: {
  providers: Connection[]; models: Model[]; modelId: string | null; onChange: (modelId: string | null) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const reduced = useReducedMotion();
  const selected = models.find(model => model.id === modelId);
  const connection = providers.find(provider => provider.id === selected?.connection_id);

  return <section aria-label="Image generation settings" className="overflow-hidden rounded-2xl border border-white/10 bg-[#141414]">
    <h3>
      <button type="button" aria-label="Image generation" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-white/[.025] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/40 sm:p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[.03]">
          {connection ? <ProviderLogo providerId={connection.provider_id} name={connection.display_name} baseUrl={connection.base_url} size={19} /> : <ImagePlus size={17} className="text-neutral-400" />}
        </span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-white">Image generation</span><span className="mt-0.5 block truncate text-[11px] font-normal text-neutral-500">{selected?.display_name || 'Automatic'}</span></span>
        <ChevronDown size={14} className={`shrink-0 text-neutral-500 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
      </button>
    </h3>
    <motion.div id={panelId} initial={false} animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }} transition={{ duration: reduced ? 0 : .2 }} inert={!expanded} aria-hidden={!expanded} className="overflow-hidden">
      <div className="space-y-3 border-t border-white/[.06] p-4 sm:p-5">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="block min-w-0 space-y-2 text-xs text-neutral-400"><span>Provider</span>
            <VoidSelect aria-label="Image provider" value={connection?.id || ''} className="text-white" onChange={event => {
              const id = event.target.value;
              void onChange(id && selected?.connection_id === id ? selected.id : models.find(model => model.connection_id === id)?.id || null);
            }} options={[{ value: '', label: 'Automatic' }, ...providers.filter(provider => models.some(model => model.connection_id === provider.id)).map(provider => ({ value: provider.id, label: provider.display_name, icon: <ProviderLogo providerId={provider.provider_id} name={provider.display_name} baseUrl={provider.base_url} size={16} /> }))]} />
          </label>
          <label className="block min-w-0 space-y-2 text-xs text-neutral-400"><span>Model</span>
            <VoidSelect aria-label="Image model" value={selected?.id || ''} className="text-white" onChange={event => void onChange(event.target.value || null)} options={[{ value: '', label: 'Automatic' }, ...models.filter(model => !connection || model.connection_id === connection.id).map(model => ({ value: model.id, label: model.display_name }))]} />
          </label>
        </div>
        {!models.length && <p className="text-[11px] text-neutral-500">No image models connected.</p>}
      </div>
    </motion.div>
  </section>;
}
