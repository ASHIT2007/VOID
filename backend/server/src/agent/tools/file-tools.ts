import fs from 'fs';
import path from 'path';
import { registerTool, ToolHandler, ToolResult } from '../tool-registry.js';

export function registerFileTools(): void {
  const readHandler: ToolHandler = async (args) => {
    const filepath = args.filepath as string;
    if (typeof filepath !== 'string') return { content: '', error: 'filepath is required' };

    try {
      const stats = fs.statSync(filepath);
      const ext = path.extname(filepath).toLowerCase();
      const textExts = ['.txt', '.md', '.json', '.csv', '.ts', '.js', '.py', '.html', '.css'];

      if (textExts.includes(ext)) {
        let content = fs.readFileSync(filepath, 'utf-8');
        if (content.length > 32000) {
          content = content.substring(0, 32000) + '\n...[Truncated]';
        }
        return { content };
      } else {
        return { content: `File metadata: size ${stats.size} bytes. Binary reading isn't supported for ${ext} files.` };
      }
    } catch (err: any) {
      return { content: '', error: `Failed to read file: ${err.message}` };
    }
  };

  const writeHandler: ToolHandler = async (args) => {
    const filepath = args.filepath as string;
    const content = args.content as string;
    if (typeof filepath !== 'string' || typeof content !== 'string') return { content: '', error: 'filepath and content are required' };

    try {
      const dir = path.dirname(filepath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filepath, content, 'utf-8');
      const stats = fs.statSync(filepath);
      return { content: `Successfully wrote ${stats.size} bytes to ${filepath}` };
    } catch (err: any) {
      return { content: '', error: `Failed to write file: ${err.message}` };
    }
  };

  registerTool(
    'file_read',
    {
      type: 'function',
      function: {
        name: 'file_read',
        description: 'Read a file from disk',
        parameters: {
          type: 'object',
          properties: { filepath: { type: 'string' } },
          required: ['filepath']
        }
      }
    },
    readHandler,
    { requiresConfirmation: false, readOnly: true, category: 'file' }
  );

  registerTool(
    'file_write',
    {
      type: 'function',
      function: {
        name: 'file_write',
        description: 'Write content to a file',
        parameters: {
          type: 'object',
          properties: { filepath: { type: 'string' }, content: { type: 'string' } },
          required: ['filepath', 'content']
        }
      }
    },
    writeHandler,
    { requiresConfirmation: true, readOnly: false, category: 'file' }
  );
}
