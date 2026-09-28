'use client';
import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import CodeBlockWithPreview from './CodeBlockWithPreview';
import { dsaFlowchart, weekendFlowchart, weekendMindmap } from '@/lib/diagram-examples';

export default function DiagramPreview() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  return <main className={`${theme === 'dark' ? 'dark bg-[#1e1e1e] text-neutral-100' : 'bg-white text-neutral-900'} min-h-screen px-5 py-8`}>
    <div className="mx-auto max-w-4xl">
      <header className="mb-8 flex items-center justify-between text-sm">
        <span className="text-neutral-500">VOID · Diagrams</span>
        <button aria-label="Toggle diagram theme" className="rounded-lg p-2 transition hover:bg-neutral-500/10" onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
      </header>
      <section aria-label="DSA learning roadmap"><p className="mb-2 text-sm text-neutral-500">A path to learning data structures and algorithms.</p><CodeBlockWithPreview language="mermaid" code={dsaFlowchart} theme={theme} /></section>
      <div className="mt-12 grid items-start gap-10 md:grid-cols-2">
        <section aria-label="Weekend flowchart"><p className="mb-2 text-sm text-neutral-500">A simple plan for a slow Saturday.</p><CodeBlockWithPreview language="mermaid" code={weekendFlowchart} theme={theme} /></section>
        <section aria-label="Weekend mind map"><p className="mb-2 text-sm text-neutral-500">Ideas for the weekend, grouped by activity.</p><CodeBlockWithPreview language="mermaid" code={weekendMindmap} theme={theme} /></section>
      </div>
    </div>
  </main>;
}
