import { registerTool, ToolHandler, ToolResult } from '../tool-registry.js';
import { normalizeMermaid } from '@void/shared/diagram-contract.mjs';

export function registerDiagramTools(): void {
  const handler: ToolHandler = async (args) => {
    const code = normalizeMermaid(args.code);
    const title = args.title as string | undefined;
    
    if (!code) return { content: 'Provide a complete Mermaid diagram with a supported header and actual nodes. No configuration directives, HTML, links or click actions.', error: 'invalid_diagram' };

    let content = '';
    if (title) {
      content += `### ${title}\n\n`;
    }
    content += `\`\`\`mermaid\n${code}\n\`\`\``;

    return { content };
  };

  registerTool(
    'render_diagram',
    {
      type: 'function',
      function: {
        name: 'render_diagram',
        description: 'Render a Mermaid relationship/process diagram or Mermaid mind map as a visual. Use mindmap for hierarchies, flowchart for workflows, sequenceDiagram for interactions. Quantitative charts use native chart JSON, not this tool.',
        parameters: {
          type: 'object',
          properties: { code: { type: 'string' }, title: { type: 'string' } },
          required: ['code']
        }
      }
    },
    handler,
    { requiresConfirmation: false, readOnly: true, category: 'data' }
  );
  registerTool('render_chart', { type: 'function', function: { name: 'render_chart', description: 'Render native numeric bar, line, area, scatter or pie chart JSON separately from Mermaid diagrams. Values must be finite and factual or visibly labeled subjective/illustrative. Never generate an image of a chart.',
    parameters: { type: 'object', properties: { chart: { type: 'object' } }, required: ['chart'] } } }, async args => {
    const chart = args.chart as Record<string, unknown>;
    if (!chart || typeof chart.title !== 'string' || !['bar', 'horizontal-bar', 'line', 'area', 'scatter', 'pie', 'donut'].includes(String(chart.type))) return { content: 'Provide a supported chart type and title.', error: 'invalid_chart' };
    const field = ['pie', 'donut'].includes(String(chart.type)) ? 'slices' : chart.type === 'scatter' ? 'scatterPoints' : ['line', 'area'].includes(String(chart.type)) ? 'points' : 'bars';
    const values = chart[field];
    if (!Array.isArray(values) || !values.length || values.length > 200 || values.some(row => !row || (chart.type === 'scatter'
      ? !Number.isFinite(row.x) || !Number.isFinite(row.y)
      : typeof row.label !== 'string' || !Number.isFinite(row.value)))) return { content: 'Every observation needs valid numeric values and matching labels/X-Y coordinates.', error: 'invalid_chart' };
    if (['pie', 'donut'].includes(String(chart.type)) && (values.some(row => row.value < 0) || !values.some(row => row.value > 0))) return { content: 'Pie/donut values must be non-negative with a positive total.', error: 'invalid_chart' };
    if (['line', 'area'].includes(String(chart.type)) && values.some(row => row.x !== undefined && !Number.isFinite(row.x))) return { content: 'Numeric X coordinates must be finite and paired with their Y values.', error: 'invalid_chart' };
    return { content: `\`\`\`chart\n${JSON.stringify({ ...chart, style: { background: 'transparent', surface: 'transparent' } })}\n\`\`\`` };
  }, { readOnly: true, requiresConfirmation: false, category: 'data' });
}
