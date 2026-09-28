'use client';
import React, { useEffect, useId, useState } from 'react';
import { Download, ZoomIn, ZoomOut, RotateCcw, ChevronDown } from 'lucide-react';
import { normalizeMermaid } from '@void/shared/diagram-contract.mjs';
import { mermaidConfig } from '@/lib/mermaid-theme';

// Mermaid owns global configuration; serialize initialization/rendering across messages.
let renderQueue: Promise<unknown> = Promise.resolve();
export default function MermaidRenderer({ chart, theme = 'dark' }: { chart?: string; theme?: 'dark' | 'light' }) {
  const id = `void-diagram-${useId().replace(/[^a-z0-9]/gi, '')}`;
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [retry, setRetry] = useState(0);
  const [naturalWidth, setNaturalWidth] = useState(800);
  const code = normalizeMermaid(chart);
  useEffect(() => {
    let cancelled = false;
    setSvg(''); setError(''); setZoom(1);
    if (!code) { setError('This diagram is incomplete or contains unsupported actions. Ask VOID to regenerate it with valid Mermaid syntax.'); return; }
    renderQueue = renderQueue.catch(() => {}).then(async () => {
      if (cancelled) return;
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize(mermaidConfig(theme));
        const result = await mermaid.render(id, code);
        // Mermaid may include XHTML labels for some diagram types. Parse as HTML
        // to normalize void tags before exporting a well-formed SVG document.
        const document = new DOMParser().parseFromString(result.svg, 'text/html');
        const root = document.querySelector('svg');
        if (!root) throw new Error('Missing diagram SVG');
        const width = Number(root.getAttribute('viewBox')?.trim().split(/\s+/)[2]);
        root.style.maxWidth = 'none';
        // Keep spaces between Mermaid's word-level tspans in standalone viewers.
        root.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        root.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
        root.querySelectorAll('text').forEach(text => { text.style.whiteSpace = 'pre'; });
        // Mermaid centers circle label groups at x=0, but SVG text defaults to
        // start alignment when HTML labels are disabled. Center those labels.
        root.querySelectorAll('.mindmap-node > circle').forEach(circle => {
          circle.parentElement?.querySelectorAll('text').forEach(text => text.setAttribute('text-anchor', 'middle'));
        });
        root.setAttribute('role', 'img');
        if (!root.hasAttribute('aria-labelledby')) root.setAttribute('aria-label', code.startsWith('mindmap') ? 'Mind map' : 'Mermaid diagram');
        if (!cancelled) {
          setNaturalWidth(Number.isFinite(width) && width > 0 ? width : 800);
          setSvg(new XMLSerializer().serializeToString(root));
        }
      } catch {
        if (!cancelled) setError('VOID could not render this diagram. Its Mermaid syntax may be invalid. Ask for a corrected diagram, or view the source below.');
      }
    });
    return () => { cancelled = true; };
  }, [code, theme, id, retry]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const link = document.createElement('a'); link.href = url; link.download = 'void-diagram.svg';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  return <section aria-label="Diagram preview" className="my-6 w-full min-w-0 bg-transparent text-neutral-600 dark:text-neutral-300">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
      <strong>{code?.startsWith('mindmap') ? 'Mind map' : 'Diagram'}</strong>
      <div className="flex items-center gap-1">
        <button aria-label="Zoom out diagram" className="rounded-lg p-2 transition hover:bg-black/5 active:scale-95 dark:hover:bg-white/10" onClick={() => setZoom(value => Math.max(.5, value - .2))}><ZoomOut size={14} /></button>
        <button aria-label="Zoom in diagram" className="rounded-lg p-2 transition hover:bg-black/5 active:scale-95 dark:hover:bg-white/10" onClick={() => setZoom(value => Math.min(3, value + .2))}><ZoomIn size={14} /></button>
        <button aria-label="Reset diagram zoom" className="rounded-lg p-2 transition hover:bg-black/5 active:scale-95 dark:hover:bg-white/10" onClick={() => setZoom(1)}><RotateCcw size={14} /></button>
        <button disabled={!svg} aria-label="Download diagram as SVG" className="rounded-lg p-2 transition hover:bg-black/5 active:scale-95 disabled:opacity-40 dark:hover:bg-white/10" onClick={download}><Download size={14} /></button>
      </div>
    </div>
    <div className="min-h-32 overflow-x-auto py-2">
      {error ? <div role="alert" className="space-y-3 text-sm text-neutral-600 dark:text-neutral-300"><p>{error}</p><button className="rounded border border-neutral-500 px-3 py-1.5" onClick={() => setRetry(value => value + 1)}>Retry rendering</button></div>
        : svg ? <div className="void-mermaid mx-auto transition-[width] duration-150 motion-reduce:transition-none [&_svg]:block [&_svg]:h-auto [&_svg]:w-full" style={{ width: `min(${zoom * 100}%, ${naturalWidth * zoom}px)` }} dangerouslySetInnerHTML={{ __html: svg }} />
          : <p role="status" className="text-sm text-neutral-400">Rendering diagram…</p>}
    </div>
    <details className="mt-2 py-2 text-xs text-neutral-500"><summary className="flex cursor-pointer items-center gap-2 transition hover:text-neutral-900 dark:hover:text-neutral-200"><ChevronDown size={12} />Diagram source</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap">{chart}</pre></details>
  </section>;
}
