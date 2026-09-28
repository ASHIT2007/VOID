import { notFound } from 'next/navigation';
import VisualDesignStudio from '@/components/VisualDesignStudio';
import type { PresentationData } from '@/types/presentation';

export default function PresentationPreview() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const data: PresentationData = {
    id: 'render-regression', title: 'From question to discovery', format: 'presentation', theme: 'academic-clean', hideImages: false,
    slides: [
      { id: 'cover', slideNumber: 1, title: 'From question to discovery', layout: 'hero', subtitle: 'How evidence turns a promising idea into a useful explanation.', content: {} },
      { id: 'body', slideNumber: 2, title: 'Make the question specific', layout: 'split', imageUrl: 'https://example.invalid/unavailable.jpg', visualRole: 'documentary-image', content: { bodyText: 'A precise question identifies what to observe, what to compare, and which outcomes would challenge the proposed explanation.', bullets: ['Define the observation before selecting a method.', 'Record uncertainty alongside each result.', 'Explain what the experiment cannot establish.'] } },
      { id: 'timeline', slideNumber: 3, title: 'A repeatable process', layout: 'timeline', content: { timeline: [{ step: '01', title: 'Observe', description: 'Describe the question and the evidence needed.' }, { step: '02', title: 'Compare', description: 'Test predictions against repeated observations.' }, { step: '03', title: 'Review', description: 'Share methods and consider alternative explanations.' }] } },
      { id: 'matrix', slideNumber: 4, title: 'Choose a next step', layout: 'quadrant', content: { matrix: { xLabel: 'Effort', yLabel: 'Learning value', items: [{ label: 'Pilot', x: 25, y: 80 }, { label: 'Repeat', x: 65, y: 65 }, { label: 'Review', x: 25, y: 30 }] } } },
      { id: 'closing', slideNumber: 5, title: 'Keep the explanation open to revision', layout: 'closing', content: { bodyText: 'A useful explanation accounts for the available evidence and makes its limitations visible. New observations may support it, narrow its scope, or require a different explanation.', bullets: ['Make claims proportionate to the evidence.', 'Let others examine the method and the results.'] } },
      { id: 'sources', slideNumber: 6, title: 'Sources & further reading', layout: 'references', content: { sources: ['https://www.nasa.gov/science/'] } },
    ],
  };
  return <main className="h-screen"><VisualDesignStudio data={data} /></main>;
}
