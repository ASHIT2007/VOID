'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import ChartViewer from './ChartViewer';
import { answerTypographyComponents } from './AnswerTypography';
import ScrollToLatestButton from './ScrollToLatestButton';
import { presentationSummary } from '@/lib/design/presentation-summary';
import type { PresentationData } from '@/types/presentation';
import { extractThinkAndDisplayContent } from './ChatInterface.helpers';
import { chartAnswer, parseChartData } from '@/lib/chart-data';
import CodeBlockWithPreview from './CodeBlockWithPreview';

const deck: PresentationData = { id: 'preview', title: 'World War II: The Global Conflict', theme: 'academic-clean',
  slides: ['World War II: The Global Conflict', 'Origins of the conflict', 'The European theater', 'The Pacific theater', 'Major turning points', 'The home front', 'The end of the war', 'Legacy and consequences', 'Sources']
    .map((title, index) => ({ id: String(index), slideNumber: index + 1, title, layout: index === 8 ? 'references' : 'editorial', content: {} })) };
const sample = '# Satoru Gojo’s strongest abilities\n\nGojo’s most powerful abilities come from **Limitless** and the **Six Eyes**. Together, they let him control space with exceptional precision.\n\n## Space manipulation\n\n- **Infinity:** Slows approaching objects so they cannot normally reach him.\n- **Blue and Red:** Create attraction and repulsion through different applications of Limitless.\n- **Hollow Purple:** Combines Blue and Red into a destructive technique.\n\n### The role of Six Eyes\n\nSix Eyes improves his perception and control of cursed energy, allowing precise use of his techniques.\n\n## Domain expansion\n\n**Unlimited Void** overwhelms opponents with information, leaving them unable to act.';
const recovered = chartAnswer(JSON.stringify({ chart: { type: 'bar_chart', title: 'Ash’s Pokémon — illustrative fan comparison', subtitle: 'Preview fixture: subjective battle ratings, 0–100', xLabel: 'Pokémon', yLabel: 'Subjective rating (0–100)', data: [{ pokemon: 'Pikachu', powerLevel: '95' }, { pokemon: 'Charizard', powerLevel: 90 }, { pokemon: 'Greninja', powerLevel: 92 }], note: 'Example values for verifying chart recovery, not official Pokémon statistics.' } }), { subjective: true })!;
const recoveredChart = parseChartData(recovered.match(/```chart\s*([\s\S]*?)```/)![1])!;

export default function AnswerFormattingPreview() {
  const [loading, setLoading] = useState(true);
  const [jumped, setJumped] = useState(false);
  return <main className="dark min-h-screen bg-[#1e1e1e] px-5 py-10 text-gray-100">
    <div className="mx-auto max-w-3xl space-y-12">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="text-sm text-gray-400">Answer formatting preview</h1>
        <button className="rounded-full border border-neutral-600 px-3 py-1.5 text-sm" onClick={() => setLoading(value => !value)}>{loading ? 'Finish response' : 'Start response'}</button>
      </header>
      <section className="answer-markdown"><ReactMarkdown components={answerTypographyComponents}>{sample}</ReactMarkdown></section>
      <section className="answer-markdown" aria-label="Provider protocol protection preview">
        <h2 className="mb-4 text-sm text-gray-400">Provider protocol protection</h2>
        <ReactMarkdown components={answerTypographyComponents}>{extractThinkAndDisplayContent('```json\n{"type":"web_search","query":"Satoru Gojo Jujutsu Kaisen character overview"}\n```\n\n## Satoru Gojo\n\nSatoru Gojo is a powerful jujutsu sorcerer and a teacher at Tokyo Jujutsu High. His signature abilities include Limitless and the Six Eyes.').displayContent}</ReactMarkdown>
      </section>
      <section><h2 className="mb-4 text-sm text-gray-400">Presentation brief</h2>
        <p className="answer-paragraph">{presentationSummary(deck)}</p>
        <div className="inline-flex items-center gap-3 rounded-xl border border-neutral-700 px-4 py-3 text-sm"><strong>{deck.title}</strong><span className="text-gray-400">9 slides</span></div>
      </section>
      <section><ChartViewer data={{ type: 'bar', title: 'Category comparison', subtitle: 'Illustrative values', xLabel: 'Category', yLabel: 'Value', bars: [{ label: 'A', value: 12 }, { label: 'B', value: 27 }, { label: 'C', value: 18 }], note: 'Example values for layout verification.' }} /></section>
      <section aria-label="Recovered Pokémon chart"><ChartViewer data={recoveredChart} /></section>
      <section aria-label="Mermaid regression examples"><CodeBlockWithPreview language="mermaid" code={'mindmap\n  root((VOID))\n    Research\n      Web sources\n      Citations\n    Create\n      Documents\n      Presentations\n    Voice\n      Hindi\n      Hinglish'} /><CodeBlockWithPreview language="mermaid" code={'flowchart TB\n  A[Start] --> B[Enter username and password]\n  B --> C{Credentials valid?}\n  C -->|Yes| D[Grant access]\n  D --> E[Redirect to dashboard]\n  C -->|No| F[Show error message]\n  F --> G[Retry or log out]\n  G --> B\n  E --> H[Open workspace]\n  H --> I[Create a file]\n  I --> J[Download your file]\n  J --> K[Finish]'} /><CodeBlockWithPreview language="mindmap" code={JSON.stringify({ title: 'Machine learning', categories: [{ name: 'Supervised learning', children: ['Decision trees', 'Support vector machines', 'Neural networks'] }, { name: 'Applications', children: ['Computer vision', 'Healthcare', 'Natural language processing'] }] })} /></section>
      <section><ChartViewer data={{ type: 'line', title: 'Uneven numerical intervals', xLabel: 'Elapsed time (s)', yLabel: 'Measurement', points: [{ label: '0', x: 0, value: 0 }, { label: '1', x: 1, value: -5 }, { label: '10', x: 10, value: 10 }] }} /></section>
      <section><ChartViewer data={{ type: 'pie', title: 'Category distribution', slices: [{ label: 'Category A', value: 30 }, { label: 'Category B', value: 45 }, { label: 'Category C', value: 25 }] }} /></section>
      <section data-narrow-preview style={{ maxWidth: 320 }}><ChartViewer data={{ type: 'bar', title: 'Narrow chart preview', xLabel: 'Category', yLabel: 'Value', bars: [{ label: 'A', value: 12 }, { label: 'B', value: 27 }, { label: 'C', value: 18 }] }} /></section>
      <section className="relative h-20"><ScrollToLatestButton loading={loading} onClick={() => setJumped(true)} />
        {jumped && <p className="pt-14 text-center text-sm text-gray-400">Scroll control clicked</p>}
      </section>
    </div>
  </main>;
}
