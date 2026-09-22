"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Laptop, Tablet, Smartphone, RotateCcw, ExternalLink } from 'lucide-react';
import { buildPreviewDocument, previewDimensions, type PreviewDevice } from '@/lib/web-preview';

const subscribeOrigin = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => '';

export default function WebPreview({ content, title = 'Web preview' }: { content: string; title?: string }) {
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [reload, setReload] = useState(0);
  const origin = useSyncExternalStore(subscribeOrigin, getOrigin, getServerOrigin);
  const [bounds, setBounds] = useState({ width: 640, height: 600 });
  const [failure, setFailure] = useState<{ content: string; reload: number; message: string } | null>(null);
  const error = failure?.content === content && failure.reload === reload ? failure.message : '';
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const channel = useId();
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0)
        setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== 'void-preview' || event.data?.channel !== channel) return;
      if (event.data.type === 'error') setFailure({ content, reload, message: String(event.data.message).slice(0, 240) });
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [content, reload, channel]);
  const document = useMemo(() => buildPreviewDocument(content, origin, channel), [content, origin, channel]);
  const size = previewDimensions(device, bounds.width, bounds.height);
  const open = () => {
    const url = URL.createObjectURL(new Blob([document], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-[#101010]">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#333] bg-[#1b1b1b] px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-xs text-gray-400" title={title}>{title}</span>
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Preview devices">
        {([{ id: 'desktop', label: 'Desktop', Icon: Laptop }, { id: 'tablet', label: 'Tablet', Icon: Tablet }, { id: 'mobile', label: 'Mobile', Icon: Smartphone }] as const).map(({ id, label, Icon }) =>
          <button key={id} type="button" aria-label={label + ' preview'} aria-pressed={device === id} title={label + ' preview'} onClick={() => setDevice(id)} className={`rounded-md p-2 focus-visible:outline-2 focus-visible:outline-white ${device === id ? 'bg-white text-black' : 'text-gray-400 hover:bg-[#333] hover:text-white'}`}><Icon size={15}/></button>)}
        <button type="button" aria-label="Reload preview" title="Reload preview" onClick={() => setReload(x => x + 1)} className="rounded-md p-2 text-gray-400 hover:bg-[#333] hover:text-white"><RotateCcw size={15}/></button>
        <button type="button" aria-label="Open preview in new tab" title="Open preview in new tab" onClick={open} className="rounded-md p-2 text-gray-400 hover:bg-[#333] hover:text-white"><ExternalLink size={15}/></button>
      </div>
    </div>
    {error && <div role="alert" className="shrink-0 border-b border-[#444] bg-[#242424] px-3 py-2 text-xs text-gray-200">Preview error: {error}</div>}
    <div className="min-h-0 flex-1 p-2 sm:p-3">
      <div ref={host} className="relative h-full min-h-0 w-full overflow-hidden">
        {origin && <div className="absolute top-0 overflow-hidden rounded-md bg-white" style={{ width: size.width * size.scale, height: size.height * size.scale, left: '50%', transform: 'translateX(-50%)' }}>
          <iframe key={reload} ref={frame} srcDoc={document} title={title} loading="eager" className="block border-0 bg-white" style={{ width: size.width, height: size.height, transform: `scale(${size.scale})`, transformOrigin: 'top left' }} sandbox="allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock allow-downloads" allow="fullscreen; autoplay" allowFullScreen />
        </div>}
      </div>
    </div>
  </div>;
}
