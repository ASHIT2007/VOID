import { registerTool, ToolResult, ToolOptions } from '../tool-registry.js';

interface WebFetchArgs {
  url: string;
}

export function registerWebFetchTools(): void {
  const options: ToolOptions = { readOnly: true, requiresConfirmation: false, category: 'retrieval' };

  registerTool(
    'web_fetch',
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch and extract text content from a URL.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to fetch' }
          },
          required: ['url']
        }
      }
    },
    async (args: Record<string, unknown>): Promise<ToolResult> => {
      const { url } = args as unknown as WebFetchArgs;
      
      if (!url) {
        return { content: 'Error: url is required.', error: 'url missing' };
      }

      try {
        const jinaKey = process.env.JINA_API_KEY;
        const headers: Record<string, string> = { Accept: 'text/markdown' };
        if (jinaKey) {
          headers['Authorization'] = `Bearer ${jinaKey}`;
        }

        const res = await fetch(`https://r.jina.ai/${url}`, { headers });
        if (res.ok) {
          let content = await res.text();
          if (content.length > 16000) {
            content = content.substring(0, 16000);
          }
          const wordCount = content.split(/\s+/).length;
          const formatted = `Title: Fetched Document\nURL: ${url}\nWord Count: ${wordCount}\n---\n${content}`;
          return { content: formatted };
        } else {
          // Fallback to raw fetch
          const rawRes = await fetch(url);
          let html = await rawRes.text();
          // Simple strip HTML
          let content = html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
          if (content.length > 16000) {
            content = content.substring(0, 16000);
          }
          const wordCount = content.split(/\s+/).length;
          const formatted = `Title: Unknown\nURL: ${url}\nWord Count: ${wordCount}\n---\n${content}`;
          return { content: formatted };
        }
      } catch (err: any) {
        return { content: `Error fetching URL: ${err.message}`, error: err.message };
      }
    },
    options
  );
}

registerWebFetchTools();
