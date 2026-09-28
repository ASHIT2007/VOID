'use client';
import { useState, type ReactNode } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { deviceEntries } from '@/lib/workspace/device-store';
import type { GeneratedFile } from '@/lib/workspace/generate-file';

export function downloadDeviceFile(file: GeneratedFile) {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a'); link.href = url; link.download = file.filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function DeviceFileLink({ fileId, children }: { fileId: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const download = async () => {
    if (busy) return; setBusy(true); setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sign in to download this file.');
      const file = (await deviceEntries<GeneratedFile>(session.user.id, 'file')).find(entry => entry.id === `${session.user.id}:file:${fileId}`)?.value;
      if (!file) throw new Error('This file is stored in the browser where it was created. Open that browser or generate it again.');
      downloadDeviceFile(file);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return <span className="my-2 inline-flex max-w-full flex-col align-middle"><button onClick={() => void download()} disabled={busy} className="inline-flex min-w-0 items-center gap-3 rounded-xl border border-black/10 bg-black/[.025] px-4 py-3 text-left text-sm font-medium text-neutral-900 transition duration-200 hover:bg-black/[.06] active:scale-[.98] disabled:opacity-50 dark:border-white/10 dark:bg-white/[.035] dark:text-neutral-100 dark:hover:bg-white/[.08]">
    <FileText size={18} className="shrink-0 text-neutral-500" /><span className="min-w-0 break-words">{children}</span>{busy ? <Loader2 size={16} className="shrink-0 animate-spin" /> : <Download size={16} className="shrink-0 text-neutral-500" />}
  </button>{error && <span role="alert" className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{error}</span>}</span>;
}
