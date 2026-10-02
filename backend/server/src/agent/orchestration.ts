import { registerTool, getAllTools, getAllToolSchemas, type ToolResult } from './tool-registry.js';
import type { ChatToolDefinition } from '@void/shared/types.js';
import { requestedFileTools } from '@void/shared/file-intent.mjs';
import { normalizeImageIntent } from '@void/shared/chat-intent.mjs';

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

      return { content, availableTools: matches.map(tool => tool.name) };
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
  const msg = normalizeImageIntent(message).toLowerCase();
  const allSchemas = getAllToolSchemas();
  const relevantNames = new Set<string>();
  const fileTools = requestedFileTools(message);
  fileTools.forEach(name => relevantNames.add(name));

  // Search availability is independent of reasoning depth; execution stays relevance-driven.
  // Greetings and stable knowledge questions should remain plain LLM calls.
  const hasWebIntent = /\b(search|find|look up|browse|web|online|source|citation|latest|current|today|tonight|recent|news|price|score|schedule|weather|forecast|release|version|updated?|verify|fact[ -]?check|who is|when did|tell me about|overview|research|information about)\b/.test(msg);
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
    relevantNames.add('memory_list');
  }
  // The lead can retrieve requested imagery itself, so Low needs no extra model worker.
  if (/\b(?:images?|photos?|pictures?)\b/.test(msg)) relevantNames.add('image_search');
  if (!fileTools.length && /\b(?:generate|create|draw|design|make)\b[\s\S]*\b(?:image|photo|picture|illustration)\b/.test(msg)) relevantNames.add('generate_image');
  if (!fileTools.length && /\b(?:edit|inpaint|remove background|variation|style transfer)\b[\s\S]*\b(?:image|photo|picture)\b/.test(msg)) relevantNames.add('edit_image');
  if (options.webSearch && /\b(?:research|academic|paper|scholar|study)\b/.test(msg)) relevantNames.add('academic_search');
  if (/\b(?:previous|earlier|past|conversation|chats?)\b/.test(msg)) relevantNames.add('conversation_search');
  if (/\b(file|read|write|create|open)\b/.test(msg)) {
    relevantNames.add('file_read');
    relevantNames.add('file_write');
  }
  if (/\b(diagram|flowchart|mind[ -]?map|workflow|mermaid)\b/.test(msg)) {
    relevantNames.add('render_diagram');
  }
  if (/\b(?:chart|plot|graph|visualize)\b/.test(msg)) relevantNames.add('render_chart');
  if (/\b(?:docx|word document|document)\b/.test(msg)) relevantNames.add('generate_document');
  if (/\b(?:pptx?|powerpoint|presentation|slide deck)\b/.test(msg)) relevantNames.add('generate_presentation');
  if (/\b(?:xlsx|spreadsheet|workbook|excel)\b/.test(msg)) relevantNames.add('generate_spreadsheet');
  if (/\bpdf\b/.test(msg)) relevantNames.add('generate_pdf');
  if (/\b(?:usage|cost|spent|tokens?|billing)\b/.test(msg)) relevantNames.add('usage_tracker');
  if (/\b(?:provider|routing|model|route)\b/.test(msg)) relevantNames.add('provider_router');
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
  if (relevantNames.size || /\b(?:tools?|capabilities|skills)\b/.test(msg)) relevantNames.add('tool_search');
  return allSchemas.filter((s) => relevantNames.has(s.function.name)).slice(0, maxTools);
}
