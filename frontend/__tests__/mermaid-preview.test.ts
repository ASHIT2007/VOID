import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import CodeBlockWithPreview from '../components/CodeBlockWithPreview';
import { detectCodeLanguage } from '../lib/code-language';
import { extractToolProtocol } from '@void/shared/tool-protocol.mjs';
import { mindMapToMermaid, graphToMermaid } from '../lib/diagram-data';
import { normalizeMermaid, diagramAnswer } from '@void/shared/diagram-contract.mjs';
import { dsaFlowchart, weekendFlowchart, weekendMindmap } from '../lib/diagram-examples';
import { mermaidConfig } from '../lib/mermaid-theme';
describe('diagram delivery', () => {
  it('preserves authored colors, decision branches and multiline subtitles through delivery', () => {
    for (const diagram of [dsaFlowchart, weekendFlowchart, weekendMindmap]) expect(normalizeMermaid(diagram)).toBe(diagram);
    const answer = diagramAnswer(`Here are both.\n\n\`\`\`mermaid\n${weekendFlowchart}\n\`\`\`\n\n\`\`\`mermaid\n${weekendMindmap}\n\`\`\``)!;
    expect(answer).toContain(weekendFlowchart); expect(answer).toContain(weekendMindmap);
    expect(normalizeMermaid(dsaFlowchart)).toContain('classDef structures fill:#493886');
    expect(normalizeMermaid(dsaFlowchart)).toContain('**Arrays and strings**\nTwo pointers');
  });
  it('uses contrasting root/branch themes without disabling Mermaid security', () => {
    for (const theme of ['dark', 'light'] as const) {
      const config = mermaidConfig(theme);
      expect(config.securityLevel).toBe('strict'); expect(config.flowchart?.htmlLabels).toBe(false);
      const colors = config.themeVariables;
      expect(new Set([colors.cScale1, colors.cScale2, colors.cScale3, colors.cScale4]).size).toBe(4);
      expect(colors.cScale0).not.toBe(colors.cScaleLabel0);
    }
    for (const unsafe of ['flowchart TD\nA-->B\nclick A "https://example.com"', '%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\nA-->B', 'flowchart TD\nA["<img src=x onerror=alert(1)>"]']) expect(normalizeMermaid(unsafe)).toBeNull();
  });
  it('routes actual Mermaid mind maps to the visual preview instead of a syntax code block', () => {
    const code = 'mindmap\n  root((VOID))\n    Research\n    Documents';
    const html = renderToStaticMarkup(React.createElement(CodeBlockWithPreview, { language: 'mermaid', code }));
    expect(html).toContain('Diagram preview'); expect(html).toContain('Mind map'); expect(html).toContain('Rendering diagram');
    expect(html).not.toContain('Save snippet'); expect(detectCodeLanguage(code)).toBe('mermaid');
    expect(html).not.toMatch(/max-h-\[600px\]|rounded-xl border border-neutral-700/);
    expect(detectCodeLanguage('flowchart LR\n A[Request] --> B[Answer]')).toBe('mermaid');
  });
  it('shows every JSON mind-map branch through the same unclipped diagram renderer', () => {
    const data = { title: 'Machine learning', categories: [{ name: 'Learning', children: ['Supervised', 'Unsupervised'] }, { name: 'Applications', children: ['Health', 'Vision'] }] };
    expect(mindMapToMermaid(data)).toContain('Unsupervised'); expect(mindMapToMermaid(data)).toContain('Vision');
    const html = renderToStaticMarkup(React.createElement(CodeBlockWithPreview, { language: 'mindmap', code: JSON.stringify(data) }));
    expect(html).toContain('Diagram preview'); expect(html).not.toContain('Click to highlight');
    expect(graphToMermaid({ directed: true, nodes: [{ id: 'unsafe ID', label: 'A "quote"' }, { id: 'b' }], edges: [{ from: 'unsafe ID', to: 'b', label: 'next' }] })).toContain('node0 -->|"next"| node1');
  });
  it('hides new tool protocol payloads while preserving ordinary answers', () => {
    const result = extractToolProtocol('```json\n{"type":"generate_document","title":"Report","sections":[{"text":"Content"}]}\n```\n\nThe document is ready.');
    expect(result.text).not.toContain('sections'); expect(result.text).toContain('The document is ready.');
  });
});
