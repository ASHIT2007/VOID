import { describe, expect, it } from 'vitest';
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { renderToStaticMarkup } from 'react-dom/server';
import { answerTypographyComponents } from '../components/AnswerTypography';
import ScrollToLatestButton from '../components/ScrollToLatestButton';
import { ensurePresentationBrief, presentationSummary } from '../lib/design/presentation-summary';
import { presentationBlock } from '../lib/design/presentation-quality';
import type { PresentationData } from '../types/presentation';

describe('readable answer delivery', () => {
  it('uses a block wrapper for linked images instead of nesting a preview inside a paragraph', () => {
    const html = renderToStaticMarkup(React.createElement(ReactMarkdown, { components: answerTypographyComponents,
      children: '[![Diagram](https://example.com/image.png)](https://example.com)' }));
    expect(html).toContain('<div class="answer-paragraph">');
    expect(html).not.toContain('<p class="answer-paragraph">');
  });
  it('keeps semantic heading levels, real list markers, paragraphs and emphasis', () => {
    const html = renderToStaticMarkup(React.createElement(ReactMarkdown, { components: answerTypographyComponents,
      children: '# Title\n\nOverview paragraph.\n\n## Main topic\n\n### Details\n\n- **First:** Explanation.\n- *Second:* More details.\n\n1. Ordered step\n2. Next step' }));
    expect(html).toContain('<h1 class="answer-heading answer-title">');
    expect(html).toContain('<h2 class="answer-heading answer-section">');
    expect(html).toContain('<h3 class="answer-heading answer-subsection">');
    expect(html).toContain('<p class="answer-paragraph">Overview paragraph.</p>');
    expect(html).toContain('<ul class="answer-list answer-unordered">');
    expect(html).toContain('<li class="answer-list-item">');
    expect(html).toContain('<em>Second:</em>');
    expect(html).not.toContain('flow-root');
  });
  it('shows three loading dots below and restores the arrow when generation finishes', () => {
    const loading = renderToStaticMarkup(React.createElement(ScrollToLatestButton, { loading: true, onClick() {} }));
    expect(loading).toContain('Answer loading below. Scroll to latest message');
    expect(loading.match(/animation-delay:/g)).toHaveLength(3);
    expect(loading).not.toContain('<svg');
    const idle = renderToStaticMarkup(React.createElement(ScrollToLatestButton, { loading: false, onClick() {} }));
    expect(idle).toContain('<svg');
    expect(idle).not.toContain('answer-loading-dots');
  });
  it('gives each presentation a factual brief from the title, slide count and actual topics', () => {
    const deck: PresentationData = { id: 'deck', title: 'World War II', theme: 'academic-clean', slides: [
      { id: '1', slideNumber: 1, layout: 'editorial', title: 'World War II', content: {} },
      { id: '2', slideNumber: 2, layout: 'editorial', title: 'Origins of the conflict', content: {} },
      { id: '3', slideNumber: 3, layout: 'editorial', title: 'Major turning points', content: {} },
      { id: '4', slideNumber: 4, layout: 'references', title: 'Sources', content: {} },
    ] };
    const summary = presentationSummary(deck);
    expect(summary).toBe('I created a 4-slide presentation titled “World War II”. It covers Origins of the conflict and Major turning points.');
    const block = presentationBlock(deck);
    expect(block.startsWith(summary + '\n\n```gamma-presentation')).toBe(true);
    expect(ensurePresentationBrief(block, deck)).toBe(block);
    const recovered = ensurePresentationBrief('Here is your presentation:\n\n```gamma-presentation\n{}\n```', deck);
    expect(recovered.startsWith(summary)).toBe(true);
    expect(recovered).not.toContain('Here is your presentation');
  });
});
