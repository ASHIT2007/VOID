'use client';
import { useEffect, useRef, useState } from 'react';
import { X, Terminal, FileText, Brain, Receipt, Download, Play, Upload, Loader2, Check, Trash2, Briefcase, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { downloadDeviceFile } from './DeviceFileLink';
import { supabase } from '@/lib/supabase';
import { deviceDelete, deviceEntries, devicePut, usageSummary, type Price, type UsageRecord } from '@/lib/workspace/device-store';
import { runDeviceCode } from '@/lib/workspace/run-code';
import { generateDeviceFile, type GeneratedFile } from '@/lib/workspace/generate-file';
import { readDeviceFile } from '@/lib/workspace/read-file';
type Pending = { requestId: string; token: string; name: string; args: Record<string, any>; conversationId?: string; owner: string; expiresAt: number };
type Memory = { key: string; value: string; tags: string; updatedAt: string };
type Tab = 'Code' | 'Files' | 'Memory' | 'Usage';
const automaticTools = new Set(['generate_document', 'generate_presentation', 'generate_spreadsheet', 'generate_pdf', 'file_write', 'memory_get', 'memory_list', 'usage_tracker']);
const tabs = [{ name: 'Code', icon: Terminal, description: 'Run a quick calculation or script.' }, { name: 'Files', icon: FileText, description: 'Your generated documents and downloads.' }, { name: 'Memory', icon: Brain, description: 'What VOID remembers on this device.' }, { name: 'Usage', icon: Receipt, description: 'Tokens, estimates and model preferences.' }] as const;
export default function ClientToolsHost({ preview = false }: { preview?: boolean }) {
  const [open, setOpen] = useState(preview), [tab, setTab] = useState<Tab>('Files'), [owner, setOwner] = useState(preview ? 'preview' : '');
  const [pending, setPending] = useState<Pending[]>([]), [busy, setBusy] = useState(false), [output, setOutput] = useState(''), [error, setError] = useState('');
  const [code, setCode] = useState('print(sum([1, 2, 3]))'), [language, setLanguage] = useState('python');
  const [files, setFiles] = useState<GeneratedFile[]>([]), [memory, setMemory] = useState<Memory[]>([]), [usage, setUsage] = useState<UsageRecord[]>([]);
  const [prices, setPrices] = useState<Record<string, Price>>({}), [conversation, setConversation] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null); const dialog = useRef<HTMLDivElement>(null);
  const running = useRef(false), processed = useRef(new Set<string>());
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false), [savedRate, setSavedRate] = useState(''), [deleteMemory, setDeleteMemory] = useState('');
  useEffect(() => { setMounted(true); const listener = (event: Event) => { const requested = (event as CustomEvent).detail?.tab; if (tabs.some(item => item.name === requested)) setTab(requested); setOpen(true); };
    window.addEventListener('void:open-workspace', listener); return () => window.removeEventListener('void:open-workspace', listener); }, []);
  const accountRef = useRef(owner); accountRef.current = owner;
  const active = pending[0];
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => { setPending(previous => previous.filter(item => item.requestId !== active.requestId)); setError('The chat operation expired. Request it again to run it. Any completed local file is still available.'); }, Math.max(0, active.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [active?.requestId]);
  useEffect(() => {
    if (!active) return;
    setTab(active.name.startsWith('memory_') ? 'Memory' : ['usage_tracker', 'provider_router'].includes(active.name) ? 'Usage' : active.name === 'code_execution' ? 'Code' : 'Files');
    setConversation(active.conversationId || ''); setOutput(''); setError(''); setSelectedFile(null);
  }, [active?.requestId]);
  useEffect(() => { setPending(previous => previous.filter(item => item.owner === owner)); setFiles([]); setMemory([]); setUsage([]); setPrices({}); }, [owner]);
  const reload = async (account = owner) => {
    if (!account) return;
    const [storedFiles, memories, records, storedPrices] = await Promise.all([deviceEntries<GeneratedFile>(account, 'file'), deviceEntries<Memory>(account, 'memory'), deviceEntries<UsageRecord>(account, 'usage'), deviceEntries<Price>(account, 'price')]);
    if (accountRef.current !== account) return;
    setFiles(storedFiles.map(entry => entry.value)); setMemory(memories.map(entry => entry.value)); setUsage(records.map(entry => entry.value));
    setPrices(Object.fromEntries(storedPrices.map(entry => [entry.id.slice(`${account}:price:`.length), entry.value])));
  };
  useEffect(() => {
    let mounted = true;
    const update = async () => { const { data: { session } } = await supabase.auth.getSession(); if (mounted) setOwner(preview ? 'preview' : session?.user.id || ''); };
    void update(); const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { void update(); });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [preview]);
  useEffect(() => { if (owner) void reload(owner).catch(err => setError(err.message)); }, [owner, open]);
  useEffect(() => {
    if (preview) return;
    const listener = async (event: Event) => {
      const data = (event as CustomEvent).detail;
      const { data: { session } } = await supabase.auth.getSession(); if (!session?.user.id) return;
      const account = session.user.id;
      if (data.type === 'usage_record') {
        const record = { ...data, conversationId: String(data.conversationId || '') } as UsageRecord;
        if (!record.id || !Number.isFinite(record.inputTokens) || !Number.isFinite(record.outputTokens)) return;
        await devicePut(account, 'usage', record.id, record); if (accountRef.current === account) setConversation(record.conversationId); await reload(account);
      } else if (data.type === 'client_tool') {
        setPending(previous => previous.some(item => item.requestId === data.requestId) ? previous : [...previous, { ...data, owner: account, expiresAt: data.expiresAt || Date.now() + 120000 }]);
        if (!automaticTools.has(data.name)) setOpen(true);
      }
    };
    const safe = (event: Event) => { void listener(event).catch(err => setError(err.message)); };
    window.addEventListener('void:workspace-event', safe); return () => window.removeEventListener('void:workspace-event', safe);
  }, [preview]);
  useEffect(() => { if (!open) return; const previous = document.activeElement as HTMLElement | null; dialog.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false);
      if (event.key === 'Tab') { const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,a[href]') || [])];
        const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } };
    window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); previous?.focus(); };
  }, [open, busy, active]);
  const headers = async () => { const { data: { session } } = await supabase.auth.getSession();
    if (!session || session.user.id !== owner) throw new Error('Your account changed. Sign in again before running this operation.');
    return { 'Content-Type': 'application/json', 'x-void-user-token': session.access_token }; };
  const reply = async (operation: Pending, content: string, operationError?: string) => {
    if (operation.owner !== owner) throw new Error('This operation belongs to a different account.');
    const response = await fetch('/api/client-tool', { method: 'POST', headers: await headers(), body: JSON.stringify({ requestId: operation.requestId, token: operation.token, content: content.slice(0, 100000), error: operationError }) });
    if (!response.ok) throw new Error('This chat operation expired. The local result is still available here.');
    setPending(previous => previous.filter(item => item.requestId !== operation.requestId));
  };
  const chooseData = async () => {
    if (!selectedFile) throw new Error('Choose the source file first.');
    if (selectedFile.size > 15000000) throw new Error('Choose a file smaller than 15 MB.');
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read the selected file.')); reader.readAsDataURL(selectedFile); });
  };
  const execute = async (manualName?: string) => {
    if (running.current || !owner) return; running.current = true; setBusy(true); setError(''); setOutput('');
    try {
      if (active && active.owner !== owner) throw new Error('Your account changed. Request this operation again.');
      if (active && active.expiresAt <= Date.now()) throw new Error('This operation has expired. Request it again.');
      if (!preview) await headers();
      const name = active?.name || manualName || 'code_execution', args = active?.args || { code, language };
      let result = '';
      if (name === 'code_execution') result = await runDeviceCode(String(args.code), String(args.language || 'python'), setOutput);
      else if (name === 'file_write' || name.startsWith('generate_') && name !== 'generate_image') {
        const file = await generateDeviceFile(name, args); const id = crypto.randomUUID(); await devicePut(owner, 'file', id, file);
        result = `${file.summary}\n\n[Download ${file.filename.replace(/[\[\]\\]/g, '')}](#void-file-${id})`;
      } else if (name.startsWith('memory_')) {
        if (name === 'memory_set') { const item = { key: String(args.key).slice(0, 120), value: String(args.value).slice(0, 10000), tags: String(args.tags || '').slice(0, 300), updatedAt: new Date().toISOString() }; await devicePut(owner, 'memory', item.key, item); result = `Saved memory “${item.key}” on this device only.`; }
        else if (name === 'memory_delete') { await deviceDelete(owner, 'memory', String(args.key)); result = `Deleted local memory “${args.key}”.`; }
        else { let entries = (await deviceEntries<Memory>(owner, 'memory')).map(entry => entry.value); const query = String(args.query || '').toLowerCase();
          if (query) entries = entries.filter(entry => `${entry.key} ${entry.tags} ${entry.value}`.toLowerCase().includes(query));
          result = JSON.stringify({ storage: 'device/account IndexedDB', cloudSync: false, entries }); }
      } else if (name === 'usage_tracker') {
        const records = (await deviceEntries<UsageRecord>(owner, 'usage')).map(entry => entry.value).filter(record => record.conversationId === String(active?.conversationId || ''));
        const currentPrices = await deviceEntries<Price>(owner, 'price');
        result = JSON.stringify(usageSummary(records, Object.fromEntries(currentPrices.map(entry => [entry.id.slice(`${owner}:price:`.length), entry.value]))));
      } else if (name === 'provider_router') { localStorage.setItem(`void:routing:${owner}`, String(args.modelId)); result = 'Saved the approved connected-model preference on this device. It applies to the next chat turn; the current turn has already been routed.'; }
      else if (name === 'file_read') {
        if (!selectedFile) throw new Error('Choose the source file first.');
        const localText = await readDeviceFile(selectedFile);
        if (localText !== null) result = `${selectedFile.name} (extracted on this device; up to 95,000 characters):\n${localText}`;
        else { const data = await chooseData(); const response = await fetch('/api/file-read', { method: 'POST', headers: await headers(), body: JSON.stringify({ attachment: { name: selectedFile!.name, type: selectedFile!.type || 'application/octet-stream', base64: data.split(',')[1] } }) });
          const body = await response.json(); if (!response.ok) throw new Error(body.error); result = `${selectedFile!.name}:\n${body.content}${body.truncated ? '\n[Preview truncated at 95,000 characters.]' : ''}`; }
      } else if (name === 'generate_image' || name === 'edit_image') {
        const image = name === 'edit_image' ? args.sourceImage || await chooseData() : undefined;
        const response = await fetch('/api/generate-image', { method: 'POST', headers: await headers(), body: JSON.stringify({ prompt: args.prompt, model: 'Auto', image }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || 'The image service failed.');
        const url = body.url || body.imageUrl; if (!url) throw new Error('The image service returned no image.');
        result = `${body.notice || ''}\n${name === 'edit_image' ? 'Edited' : 'Generated'} image: ![${name === 'edit_image' ? 'Edited' : 'Generated'} image](${url})`;
      } else throw new Error('This workspace tool is unsupported.');
      setOutput(result); await reload(); if (active) await reply(active, result);
    } catch (err) { const message = err instanceof Error ? err.message : 'The operation failed.'; setError(message);
      if (active) { try { await reply(active, message, 'workspace_failed'); } catch { /* Keep local output/error visible when the stream has expired. */ } } }
    finally { running.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (!active || busy || running.current || !automaticTools.has(active.name) || processed.current.has(active.requestId)) return;
    processed.current.add(active.requestId); void execute();
  }, [active?.requestId, busy]);
  const decline = async () => { if (!active || busy) return; setBusy(true); try { await reply(active, 'The user declined this operation. No action was performed.', 'user_declined'); setOpen(false); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  const totals = usageSummary(conversation ? usage.filter(record => record.conversationId === conversation) : usage, prices);
  const download = downloadDeviceFile;
  const previewFiles = async () => {
    setBusy(true); setError('');
    try {
      for (const name of ['generate_document', 'generate_presentation', 'generate_spreadsheet', 'generate_pdf']) {
        const file = await generateDeviceFile(name, { title: 'VOID sample', sections: [{ heading: 'Results', text: 'Local generator verification.', table: [['Category', 'Value'], ['A', '12'], ['B', '27']] }],
          slides: [{ title: 'Overview', text: 'Local generator verification.', notes: 'Explain the sample.' }, { title: 'Comparison', chart: { type: 'bar', labels: ['A', 'B'], values: [12, 27] } }],
          sheets: [{ name: 'Values', rows: [['Category', 'Value'], ['A', 12], ['B', 27], ['Total', { formula: 'SUM(B2:B3)', result: 39 }]], chart: { type: 'bar', labels: ['A', 'B'], values: [12, 27] } }] });
        await devicePut(owner, 'file', `preview-${name}`, file);
      }
      await reload(); setOutput('Created four actual sample files on this test device profile.');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  if (!owner || !mounted) return null;
  const approval = active && !automaticTools.has(active.name);
  const close = () => setOpen(false);
  const button = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition duration-200 active:scale-[.97] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500';
  const secondary = `${button} border border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/[.06]`;
  const primary = `${button} bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white`;
  const input = 'rounded-lg border border-black/10 bg-black/[.025] p-2.5 text-sm outline-none transition focus:border-neutral-500 dark:border-white/10 dark:bg-white/[.035]';
  const empty = (Icon: typeof FileText, title: string, description: string) => <div className="flex flex-col items-center px-4 py-12 text-center"><Icon size={26} strokeWidth={1.5} className="mb-4 text-neutral-400" /><h3 className="text-sm font-medium">{title}</h3><p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{description}</p></div>;
  return createPortal(<AnimatePresence>{open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .18 }} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <motion.div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="workspace-title" initial={{ opacity: 0, y: reducedMotion ? 0 : 12, scale: reducedMotion ? 1 : .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 8, scale: reducedMotion ? 1 : .98 }} transition={{ duration: reducedMotion ? 0 : .2 }} className="flex max-h-[min(800px,90dvh)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white text-neutral-900 shadow-2xl outline-none dark:border-white/10 dark:bg-[#202020] dark:text-neutral-100">
      <header className="flex shrink-0 items-center justify-between gap-4 px-5 pb-4 pt-5 sm:px-6"><div className="flex min-w-0 items-center gap-3"><Briefcase size={20} className="shrink-0 text-neutral-500" /><div><h2 id="workspace-title" className="text-lg font-semibold tracking-tight">Workspace</h2><p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Code, files and memory, saved on this device.</p></div></div><button aria-label="Close workspace" onClick={close} className={`${button} h-9 w-9 shrink-0 p-0 text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10`}><X size={18} /></button></header>
      <nav className="mx-5 mb-5 grid shrink-0 grid-cols-4 rounded-xl bg-black/[.04] p-1 dark:bg-black/20 sm:mx-6" aria-label="Workspace sections">{tabs.map(({ name, icon: Icon }) => <button key={name} aria-pressed={name === tab} onClick={() => { setTab(name); setError(''); setOutput(''); }} className={`relative flex min-w-0 items-center justify-center gap-2 rounded-lg px-1 py-2.5 text-xs font-medium transition-colors sm:text-sm ${name === tab ? 'text-neutral-900 dark:text-white' : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200'}`}>
        {name === tab && <motion.span layoutId={`workspace-tab-${preview ? 'preview' : 'main'}`} transition={{ duration: reducedMotion ? 0 : .2 }} className="absolute inset-0 rounded-lg bg-white shadow-sm dark:bg-[#353535]" />}<Icon size={15} className="relative hidden shrink-0 min-[380px]:block" /><span className="relative">{name}</span></button>)}</nav>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-6">
        {approval && <section className="mb-5 rounded-xl border border-black/10 p-4 dark:border-white/10"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><ShieldCheck size={17} />{active.name.replace(/_/g, ' ')}</div><p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{['generate_image', 'edit_image', 'file_read'].includes(active.name) ? 'This action may send selected content to your connected provider and incur its charges.' : 'Review this action before VOID runs it on your device.'}</p>
          {active.name === 'code_execution' ? <pre className="my-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/[.04] p-3 text-xs dark:bg-black/20">{String(active.args.code || '')}</pre> : <p className="my-3 break-words text-sm">{String(active.args.prompt || active.args.value || active.args.key || active.args.modelId || 'Choose the source file to continue.').slice(0, 2000)}</p>}
          {(active.name === 'file_read' || active.name === 'edit_image' && !active.args.sourceImage) && <label className={`${secondary} mb-3 cursor-pointer`}><Upload size={15} />{selectedFile?.name || 'Choose source file'}<input aria-label="Choose source file" className="sr-only" type="file" accept={active.name === 'edit_image' ? 'image/*' : '.pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json,.js,.ts,.py,image/*'} onChange={event => setSelectedFile(event.target.files?.[0] || null)} /></label>}
          <div className="flex gap-2"><button disabled={busy} onClick={() => void execute()} className={primary}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}{busy ? 'Working…' : 'Approve and run'}</button><button disabled={busy} onClick={() => void decline()} className={secondary}>Decline</button></div>
        </section>}
        <motion.div key={tab} initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : .16 }}>
          {tab === 'Code' && !approval && <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-neutral-500 dark:text-neutral-400">{tabs[0].description}</p><div className="flex gap-1 rounded-lg bg-black/[.04] p-1 dark:bg-black/20">{['python', 'javascript'].map(value => <button key={value} aria-label={`Use ${value}`} aria-pressed={language === value} disabled={busy} onClick={() => { setLanguage(value); setCode(value === 'python' ? 'print(sum([1, 2, 3]))' : 'console.log([1, 2, 3].reduce((sum, n) => sum + n, 0));'); }} className={`${button} px-3 py-1.5 text-xs ${language === value ? 'bg-white shadow-sm dark:bg-[#353535]' : 'text-neutral-500'}`}>{value === 'python' ? 'Python' : 'JavaScript'}</button>)}</div></div><textarea aria-label="Code to run" spellCheck={false} disabled={busy} value={code} onChange={event => setCode(event.target.value)} rows={8} className={`${input} min-h-44 w-full resize-y p-4 font-mono leading-relaxed`} /><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-neutral-500">Standard libraries · 30-second limit · Isolated runtime</p><button disabled={busy || !!active} onClick={() => void execute()} className={primary}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}{busy ? 'Running…' : 'Run code'}</button></div></div>}
          {tab === 'Files' && <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-neutral-500 dark:text-neutral-400">{tabs[1].description}</p>{preview && <button disabled={busy} className={secondary} onClick={() => void previewFiles()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}Generate sample files</button>}</div>{files.length ? <div className="divide-y divide-black/5 dark:divide-white/5">{files.map((file, index) => <div key={index} className="flex items-center gap-3 py-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[.04] dark:bg-white/5"><FileText size={18} className="text-neutral-500" /></div><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-medium">{file.filename}</h3><p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">{file.summary}</p></div><button aria-label={`Download ${file.filename}`} onClick={() => download(file)} className={`${secondary} shrink-0 p-2.5`}><Download size={16} /></button></div>)}</div> : empty(FileText, 'Your files will appear here', 'Ask VOID to create a PowerPoint, Excel workbook, Word document or PDF. You can also download it directly from the answer.')}
            {!active && <section className="rounded-xl border border-black/10 p-4 dark:border-white/10"><h3 className="mb-2 text-sm font-medium">Read a file</h3><p className="mb-3 text-xs leading-relaxed text-neutral-500">Text, Word and Excel are read on this device. PDFs and images may use your connected service.</p><div className="flex flex-wrap gap-2"><label className={`${secondary} min-w-0 cursor-pointer`}><Upload size={15} /><span className="truncate">{selectedFile?.name || 'Choose file'}</span><input aria-label="Choose file to read" className="sr-only" type="file" accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json,.js,.ts,.py,image/*" onChange={event => setSelectedFile(event.target.files?.[0] || null)} /></label><button disabled={!selectedFile || busy} onClick={() => void execute('file_read')} className={primary}>{busy ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}Read file</button></div></section>}
          </div>}
          {tab === 'Memory' && <div className="space-y-4"><p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">Stored for this account on this device. Cloud sync is off.</p>{memory.length ? memory.map(item => <section key={item.key} className="rounded-xl border border-black/10 p-4 dark:border-white/10"><div className="flex items-center justify-between gap-3"><h3 className="break-words text-sm font-medium">{item.key}</h3><button aria-label={`Delete memory ${item.key}`} disabled={busy || !!active} onClick={() => setDeleteMemory(item.key)} className={`${button} p-2 text-neutral-500 hover:bg-black/5 dark:hover:bg-white/5`}><Trash2 size={15} /></button></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{item.value}</p>{item.tags && <p className="mt-2 text-xs text-neutral-500">{item.tags}</p>}{deleteMemory === item.key && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span>Delete this memory?</span><button className={secondary} onClick={() => { void deviceDelete(owner, 'memory', item.key).then(() => reload()).then(() => setDeleteMemory('')).catch(err => setError(err.message)); }}>Delete</button><button className={secondary} onClick={() => setDeleteMemory('')}>Cancel</button></div>}</section>) : empty(Brain, 'No saved memories', 'Ask VOID to remember a preference. You can review and delete it here.')}</div>}
          {tab === 'Usage' && <div className="space-y-5"><div className="grid grid-cols-2 gap-4"><div><p className="text-xs text-neutral-500">Input tokens</p><p className="mt-1 text-2xl font-semibold tracking-tight">{totals.inputTokens.toLocaleString()}</p></div><div><p className="text-xs text-neutral-500">Output tokens</p><p className="mt-1 text-2xl font-semibold tracking-tight">{totals.outputTokens.toLocaleString()}</p></div></div><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">{totals.estimatedCostUsd === null ? 'Add provider rates to estimate cost.' : `Estimated cost: $${totals.estimatedCostUsd.toFixed(6)}`}</p><button className={secondary} onClick={() => setConversation(value => value ? '' : usage.at(-1)?.conversationId || '')}>{conversation ? 'Show all conversations' : 'Show latest conversation'}</button></div>
            {totals.models.map(row => { const key = `${row.provider}/${row.model}`; return <section key={key} className="rounded-xl border border-black/10 p-4 dark:border-white/10"><h3 className="break-words text-sm font-medium">{row.model}</h3><p className="mt-1 text-xs text-neutral-500">{row.provider} · {row.inputTokens.toLocaleString()} in / {row.outputTokens.toLocaleString()} out · {row.estimated ? 'Estimated tokens' : 'Provider reported'}</p><div className="mt-4 flex flex-wrap items-end gap-3">{(['input', 'output'] as const).map(direction => <label key={direction} className="text-xs text-neutral-500">{direction === 'input' ? 'Input' : 'Output'} USD / 1M<input type="number" min="0" step="any" aria-label={`${direction === 'input' ? 'Input' : 'Output'} price for ${key}`} value={Number.isFinite(prices[key]?.[direction]) ? prices[key][direction] : ''} onChange={event => { setSavedRate(''); setPrices(previous => ({ ...previous, [key]: { input: previous[key]?.input ?? NaN, output: previous[key]?.output ?? NaN, [direction]: event.target.value === '' ? NaN : Number(event.target.value) } })); }} className={`${input} mt-1 block w-28 text-neutral-900 dark:text-neutral-100`} /></label>)}<button className={secondary} onClick={() => { const price = prices[key]; if (!price || !Number.isFinite(price.input) || !Number.isFinite(price.output) || price.input < 0 || price.output < 0) { setError('Enter both non-negative token prices.'); return; } void devicePut(owner, 'price', key, price).then(() => { setSavedRate(key); setError(''); }).catch(err => setError(err.message)); }}>{savedRate === key && <Check size={14} />}{savedRate === key ? 'Saved' : 'Save rates'}</button></div></section>; })}
            {!totals.models.length && empty(Receipt, 'Usage appears after your first answer', 'Each connected model’s token usage is recorded here as you chat. Add its rates to estimate cost.')}
            <p className="text-xs leading-relaxed text-neutral-500">{totals.disclosure}</p><button className={secondary} onClick={() => { localStorage.removeItem(`void:routing:${owner}`); setOutput('Provider settings will apply to your next message.'); }}>Reset model preference</button>
          </div>}
        </motion.div>
        {output && <section className="mt-5"><h3 className="mb-2 text-xs font-medium text-neutral-500">{busy ? 'Progress' : 'Result'}</h3><pre role="status" className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/[.035] p-4 text-sm leading-relaxed dark:bg-black/20">{output}</pre></section>}
        {error && <p role="alert" className="mt-4 rounded-xl border border-black/10 p-3 text-sm leading-relaxed dark:border-white/10">{error}</p>}
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-black/5 px-5 py-3 text-[11px] text-neutral-500 dark:border-white/5 sm:px-6"><ShieldCheck size={13} />Private to this browser. Download files to keep a separate copy.</footer>
    </motion.div>
  </motion.div>}</AnimatePresence>, document.body);
}
