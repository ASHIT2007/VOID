import { registerTool, getAllTools, getAllToolSchemas, type ToolResult } from './tool-registry.js';
import type { ChatToolDefinition } from '@freellmapi/shared/types.js';

/** Register meta/orchestration tools. */
export function registerOrchestrationTools(): void {
  registerTool(
    'tool_search',
    {
      type: 'function',
      function: {
        name: 'tool_search',
        description: 'Search available tools by keyword. Use when you need to find the right tool for a task.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Keyword to search across tool names and descriptions.' },
          },
          required: ['query'],
        },
      },
    },
    async (args: Record<string, unknown>): Promise<ToolResult> => {
      const query = ((args.query as string) || '').toLowerCase();
      const tools = getAllTools();

      const matches = tools.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          (t.schema.function.description?.toLowerCase().includes(query) ?? false),
      );

      if (matches.length === 0) {
        return { content: `No tools found matching "${query}".` };
      }

      const content = matches
        .map((m) => `- **${m.name}** (${m.options.category}): ${m.schema.function.description || 'No description'}`)
        .join('\n');

      return { content };
    },
    { requiresConfirmation: false, readOnly: true, category: 'meta' },
  );
}

/**
 * Returns a subset of tool schemas most likely to be relevant based on the
 * user's message. Keeps prompt token usage sane when 20+ tools are registered.
 */
export function getRelevantToolSchemas(
  message: string,
  maxTools: number = 15,
  options: { webSearch?: boolean; forceWebSearch?: boolean } = {},
): ChatToolDefinition[] {
  const msg = message.toLowerCase();
  const allSchemas = getAllToolSchemas();
  const relevantNames = new Set<string>();

  // Search availability is independent of reasoning depth; execution stays relevance-driven.
  // Greetings and stable knowledge questions should remain plain LLM calls.
  const hasWebIntent = /\b(search|find|look up|browse|web|online|source|citation|latest|current|today|tonight|recent|news|price|score|schedule|weather|forecast|release|version|updated?|verify|fact[ -]?check|who is|when did)\b/.test(msg);
  if (options.forceWebSearch || (options.webSearch && hasWebIntent)) {
    relevantNames.add('web_search');
    relevantNames.add('web_fetch');
    relevantNames.add('news_search');
  }
  if (/\b(calculate|math|compute|arithmetic)\b/.test(msg)) {
    relevantNames.add('calculator');
  }
  if (/\b(code|run|execute|python|javascript|script)\b/.test(msg)) {
    relevantNames.add('code_execution');
  }
  if (/\b(weather|temperature|forecast)\b/.test(msg)) {
    relevantNames.add('weather_fetch');
  }
  if (/\b(remember|memory|recall|forget)\b/.test(msg)) {
    relevantNames.add('memory_set');
    relevantNames.add('memory_get');
    relevantNames.add('memory_delete');
  }
  // The lead can retrieve requested imagery itself, so Low needs no extra model worker.
  if (/\b(?:images?|photos?|pictures?)\b/.test(msg)) relevantNames.add('image_search');
  if (/\b(file|read|write|create|open)\b/.test(msg)) {
    relevantNames.add('file_read');
    relevantNames.add('file_write');
  }
  if (/\b(diagram|flowchart|mind[ -]?map|workflow|mermaid)\b/.test(msg)) {
    relevantNames.add('render_diagram');
  }
  if (/\b(currency|convert|exchange rate)\b/.test(msg)) {
    relevantNames.add('currency_convert');
  }
  if (/\b(stock|share price|market|ticker)\b/.test(msg)) {
    relevantNames.add('stock_quote');
  }
  if (/\b(map|location|address|where is)\b/.test(msg)) {
    relevantNames.add('maps_search');
  }

  // Do not pad small matches with unrelated schemas. Padding made ordinary
  // chat tool-bearing, consumed scarce TPM, and encouraged accidental tools.
  return allSchemas.filter((s) => relevantNames.has(s.function.name)).slice(0, maxTools);
}
