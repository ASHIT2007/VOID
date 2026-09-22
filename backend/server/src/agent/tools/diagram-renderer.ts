import { registerTool, ToolHandler, ToolResult } from '../tool-registry.js';

export function registerDiagramTools(): void {
  const handler: ToolHandler = async (args) => {
    const code = args.code as string;
    const title = args.title as string | undefined;
    
    if (!code) return { content: '', error: 'code is required' };

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
        description: 'Render a Mermaid diagram',
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
}
