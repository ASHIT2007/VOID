import { registerTool, ToolResult, ToolOptions } from '../tool-registry.js';

interface MapsSearchArgs {
  query: string;
}

export function registerMapsSearchTools(): void {
  const options: ToolOptions = { readOnly: true, requiresConfirmation: false, category: 'retrieval' };

  registerTool(
    'maps_search',
    {
      type: 'function',
      function: {
        name: 'maps_search',
        description: 'Search for locations or addresses.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The location query' }
          },
          required: ['query']
        }
      }
    },
    async (args: Record<string, unknown>): Promise<ToolResult> => {
      const { query } = args as unknown as MapsSearchArgs;
      
      if (!query) {
        return { content: 'Error: query is required.', error: 'query missing' };
      }

      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3&addressdetails=1`, {
          headers: {
            'User-Agent': 'VOID-Agent/1.0'
          }
        });

        if (!res.ok) {
          return { content: `Error from Nominatim API: ${res.statusText}` };
        }

        const data = await res.json() as any[];
        
        if (!data || data.length === 0) {
          return { content: 'No location found for query' };
        }

        const formatted = data.map((loc: any, i: number) => {
          return `[${i + 1}] Name: ${loc.display_name}\nLat: ${loc.lat}, Lon: ${loc.lon}\nType: ${loc.type}`;
        }).join('\n\n');

        return { content: `Found ${data.length} locations:\n\n${formatted}` };
      } catch (err: any) {
        return { content: `Error during maps search: ${err.message}`, error: err.message };
      }
    },
    options
  );
}

registerMapsSearchTools();
