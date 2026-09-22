import fs from 'fs';
import path from 'path';
import { registerTool, ToolHandler, ToolResult } from '../tool-registry.js';

interface MemoryEntry {
  key: string;
  value: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const dataDir = path.resolve('data');
const memoryPath = path.join(dataDir, 'agent-memory.json');

function loadMemory(): MemoryEntry[] {
  if (!fs.existsSync(memoryPath)) return [];
  try {
    const data = fs.readFileSync(memoryPath, 'utf-8');
    return JSON.parse(data) as MemoryEntry[];
  } catch {
    return [];
  }
}

function saveMemory(entries: MemoryEntry[]): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(memoryPath, JSON.stringify(entries, null, 2), 'utf-8');
}

export function registerMemoryTools(): void {
  const setHandler: ToolHandler = async (args) => {
    const key = args.key as string;
    const value = args.value as string;
    const tagsStr = args.tags as string;
    if (!key || !value) return { content: '', error: 'key and value are required' };
    
    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()) : [];
    const entries = loadMemory();
    const existing = entries.find(e => e.key === key);
    const now = new Date().toISOString();
    
    if (existing) {
      existing.value = value;
      existing.tags = tags;
      existing.updatedAt = now;
    } else {
      entries.push({ key, value, tags, createdAt: now, updatedAt: now });
    }
    
    try {
      saveMemory(entries);
      return { content: `Memory saved for key: ${key}` };
    } catch (err: any) {
      return { content: '', error: `Failed to save memory: ${err.message}` };
    }
  };

  const getHandler: ToolHandler = async (args) => {
    const query = args.query as string | undefined;
    let entries = loadMemory();
    if (query) {
      const lowerQuery = query.toLowerCase();
      entries = entries.filter(e => 
        e.key.toLowerCase().includes(lowerQuery) || 
        e.tags.some(t => t.toLowerCase().includes(lowerQuery))
      );
    }
    return { content: entries.length ? JSON.stringify(entries, null, 2) : 'No memory entries found.' };
  };

  const deleteHandler: ToolHandler = async (args) => {
    const key = args.key as string;
    if (!key) return { content: '', error: 'key is required' };
    
    let entries = loadMemory();
    const initialLen = entries.length;
    entries = entries.filter(e => e.key !== key);
    
    if (entries.length === initialLen) {
      return { content: `No entry found for key: ${key}` };
    }
    
    try {
      saveMemory(entries);
      return { content: `Memory deleted for key: ${key}` };
    } catch (err: any) {
      return { content: '', error: `Failed to delete memory: ${err.message}` };
    }
  };

  registerTool('memory_set', { type: 'function', function: { name: 'memory_set', parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, tags: { type: 'string' } }, required: ['key', 'value'] } } }, setHandler, { requiresConfirmation: false, readOnly: false, category: 'memory' });
  registerTool('memory_get', { type: 'function', function: { name: 'memory_get', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }, getHandler, { requiresConfirmation: false, readOnly: true, category: 'memory' });
  registerTool('memory_delete', { type: 'function', function: { name: 'memory_delete', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } } }, deleteHandler, { requiresConfirmation: false, readOnly: false, category: 'memory' });
}
