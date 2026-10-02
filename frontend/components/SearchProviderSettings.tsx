'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, Compass, Globe2, Loader2, Pencil, Plus, RefreshCw, Shield, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import VoidSelect from './ui/VoidSelect';

type SearchConnection = { id: string; provider_id: 'tavily' | 'brave'; display_name: string; masked_key: string; enabled: boolean; priority: number };
const iconButton = 'flex size-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white/40 disabled:opacity-30';
const providerIcon = (id: string, size = 17) => id === 'tavily' ? <Compass size={size} /> : <Shield size={size} />;
async function request(method = 'GET', body?: Record<string, unknown>, id?: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(`/api/ai/search${id ? `?id=${encodeURIComponent(id)}` : ''}`, {
    method, headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { 'x-void-user-token': session.access_token } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not update search settings.');
  return data;
}

export default function SearchProviderSettings() {
  const [expanded, setExpanded] = useState(false);
  const [connections, setConnections] = useState<SearchConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [provider, setProvider] = useState('tavily');
  const [key, setKey] = useState('');
  const [notice, setNotice] = useState('');
  const panelId = useId();
  const reduced = useReducedMotion();
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await request(); setConnections(data.connections); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load search settings.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  const change = async (id: string, action: string, values: Record<string, unknown> = {}) => {
    setBusy(id); setNotice(''); setError('');
    try {
      const result = action === 'delete' ? await request('DELETE', undefined, id) : await request('PATCH', { id, action, ...values });
      if (action === 'delete') setConnections(current => current.filter(item => item.id !== id));
      else setConnections(current => current.map(item => item.id === id ? result.connection : item));
      if (action === 'test') setNotice('Connected');
      window.dispatchEvent(new CustomEvent('searchProvidersUpdated'));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update search settings.'); }
    finally { setBusy(null); }
  };
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy('connect'); setError(''); setNotice('');
    try {
      const result = replacing ? await request('PATCH', { id: replacing, action: 'replace', apiKey: key }) : await request('POST', { providerId: provider, apiKey: key });
      setConnections(current => replacing ? current.map(item => item.id === replacing ? result.connection : item) : [...current, result.connection]);
      setKey(''); setAdding(false); setReplacing(null); setNotice('Connected');
      window.dispatchEvent(new CustomEvent('searchProvidersUpdated'));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not connect search.'); }
    finally { setBusy(null); }
  };
  const active = connections.filter(item => item.enabled).length;
  return <section aria-label="Web search settings" className="overflow-hidden rounded-2xl border border-white/10 bg-[#141414]">
    <h3><button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-white/[.025] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/40 sm:p-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[.03] text-neutral-400"><Globe2 size={18} /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-white">Web search</span>{loading ? <span role="status" aria-label="Loading search providers" className="mt-1.5 block h-2 w-20 animate-pulse rounded bg-white/10 motion-reduce:animate-none" /> : <span className="mt-0.5 block truncate text-[11px] font-normal text-neutral-500">{error && !connections.length ? 'Unavailable' : active ? `Smart · ${active} connected` : 'Not connected'}</span>}</span>
      <ChevronDown size={14} className={`shrink-0 text-neutral-500 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
    </button></h3>
    <motion.div id={panelId} initial={false} animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }} transition={{ duration: reduced ? 0 : .2 }} inert={!expanded} aria-hidden={!expanded} className="overflow-hidden">
      <div className="space-y-3 border-t border-white/[.06] p-4 sm:p-5">
        <p className="text-[11px] leading-5 text-neutral-500">Search uses your connected keys only.</p>
        {loading ? <div role="status" aria-label="Loading search providers" className="space-y-3 animate-pulse motion-reduce:animate-none">{[0, 1].map(id => <div key={id} className="flex items-center gap-3 rounded-xl border border-white/[.06] p-3"><span className="size-8 rounded-lg bg-white/[.07]" /><span className="h-3 w-24 rounded bg-white/[.07]" /></div>)}</div> : <div className="divide-y divide-white/[.06] overflow-hidden rounded-xl border border-white/[.08]">
          {connections.map(item => <div key={item.id} className="flex flex-wrap items-center gap-3 p-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-neutral-300">{providerIcon(item.provider_id)}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-neutral-200">{item.display_name}</span><span className="block truncate text-[10px] text-neutral-500">{item.masked_key}</span></span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={busy !== null} role="switch" aria-checked={item.enabled} aria-label={`Enable ${item.display_name} search`} onClick={() => void change(item.id, 'toggle', { enabled: !item.enabled })} className={`relative mr-1 h-5 w-8 shrink-0 rounded-full transition-colors ${item.enabled ? 'bg-white' : 'bg-neutral-700'}`}><span className={`absolute top-0.5 size-4 rounded-full bg-[#171717] transition-transform motion-reduce:transition-none ${item.enabled ? 'left-0.5 translate-x-3' : 'left-0.5'}`} /></button>
              <button type="button" disabled={busy !== null} aria-label={`Test ${item.display_name} search`} title="Test connection" className={iconButton} onClick={() => void change(item.id, 'test')}>{busy === item.id ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : <RefreshCw size={14} />}</button>
              <button type="button" disabled={busy !== null} aria-label={`Replace ${item.display_name} search key`} title="Replace key" className={iconButton} onClick={() => { setReplacing(item.id); setProvider(item.provider_id); setKey(''); setAdding(true); }}><Pencil size={13} /></button>
              <button type="button" disabled={busy !== null} aria-label={`Disconnect ${item.display_name} search`} title="Disconnect" className={iconButton} onClick={() => void change(item.id, 'delete')}><Trash2 size={13} /></button>
            </div>
          </div>)}
          {!connections.length && !error && <p className="p-4 text-center text-xs text-neutral-500">Connect a key to enable web search.</p>}
          {!adding && <button type="button" disabled={busy !== null} onClick={() => { setAdding(true); setReplacing(null); setKey(''); }} aria-label="Connect a search provider" title="Connect search" className="flex w-full items-center justify-center border-t border-white/[.06] p-3 text-neutral-400 hover:bg-white/[.025] hover:text-white"><Plus size={16} /></button>}
        </div>}
        {adding && <form onSubmit={connect} className="space-y-3 rounded-xl border border-white/10 bg-white/[.02] p-3">
          <div className="grid min-w-0 gap-2 sm:grid-cols-2"><VoidSelect aria-label="Search provider" disabled={Boolean(replacing) || busy !== null} value={provider} onChange={event => setProvider(event.target.value)} className="text-white" options={[{ value: 'tavily', label: 'Tavily', icon: providerIcon('tavily', 15) }, { value: 'brave', label: 'Brave Search', icon: providerIcon('brave', 15) }]} />
            <input type="password" required autoComplete="new-password" aria-label="Search API key" placeholder="API key" disabled={busy !== null} value={key} onChange={event => setKey(event.target.value)} className="min-w-0 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2.5 text-xs text-white outline-none focus-visible:border-white/40" /></div>
          <div className="flex items-center justify-between gap-3"><p className="text-[10px] text-neutral-500">Connecting runs one small search to verify access.</p><div className="flex gap-1"><button type="button" disabled={busy !== null} aria-label="Cancel connecting search" className={iconButton} onClick={() => { setAdding(false); setReplacing(null); setKey(''); }}><X size={15} /></button><button type="submit" disabled={busy !== null || !key.trim()} aria-label={replacing ? 'Save replacement search key' : 'Connect search provider'} title={replacing ? 'Save key' : 'Connect'} className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-black disabled:opacity-30">{busy === 'connect' ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" /> : <Check size={15} />}</button></div></div>
        </form>}
        {error && <div role="alert" className="flex items-center justify-between gap-2 text-xs leading-5 text-neutral-300"><span>{error}</span><button type="button" aria-label="Retry loading search providers" disabled={busy !== null} className={iconButton} onClick={() => void load()}><RefreshCw size={14} /></button></div>}
        {notice && <p role="status" className="text-[11px] text-neutral-400">{notice}</p>}
      </div>
    </motion.div>
  </section>;
}
