import { registerTool, ToolHandler, ToolResult } from '../tool-registry.js';
import { getSession } from '../agent-session.js';

export function registerConversationSearchTools(): void {
  const handler: ToolHandler = async (args) => {
    const query = args.query as string;
    const sessionId = args.sessionId as string;
    if (!query || !sessionId) return { content: '', error: 'query and sessionId are required' };

    try {
      const session = getSession(sessionId);
      if (!session) return { content: '', error: 'Session not found' };

      const lowerQuery = query.toLowerCase();
      const matches = session.messages.filter((msg: any) => 
        msg.content && typeof msg.content === 'string' && msg.content.toLowerCase().includes(lowerQuery)
      );

      if (matches.length === 0) return { content: 'No matching messages found in conversation.' };

      const formatted = matches.map((msg: any) => {
        const snippet = msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content;
        return `[${msg.role}]: ${snippet}`;
      }).join('\n\n');

      return { content: `Found ${matches.length} matches:\n\n${formatted}` };
    } catch (err: any) {
      return { content: '', error: `Search failed: ${err.message}` };
    }
  };

  registerTool(
    'conversation_search',
    {
      type: 'function',
      function: {
        name: 'conversation_search',
        description: 'Search conversation messages',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' }, sessionId: { type: 'string' } },
          required: ['query', 'sessionId']
        }
      }
    },
    handler,
    { requiresConfirmation: false, readOnly: true, category: 'memory' }
  );
}
