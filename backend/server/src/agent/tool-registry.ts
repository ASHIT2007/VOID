import type { ChatToolDefinition } from '@freellmapi/shared/types.js';

/** Result returned by every tool handler. */
export interface ToolImage {
  url: string;
  title?: string;
  mimeType?: string;
  sourceUrl?: string;
  sourceDomain?: string;
  attribution?: string;
  alt?: string;
  query?: string;
  width?: number;
  height?: number;
  score?: number;
  confidence?: number;
  verified?: boolean;
}

export interface ToolResult {
  content: string;
  images?: ToolImage[];
  files?: { name: string; url: string; mimeType: string }[];
  sources?: { url: string; title: string; content?: string }[];
  error?: string;
}

/** Signature every tool handler must implement. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

/** Per-tool behavioural flags. */
export interface ToolOptions {
  requiresConfirmation: boolean;
  readOnly: boolean;
  category: 'retrieval' | 'code' | 'file' | 'memory' | 'data' | 'action' | 'meta';
}

/** A fully-registered tool ready for dispatch. */
export interface RegisteredTool {
  name: string;
  schema: ChatToolDefinition;
  handler: ToolHandler;
  options: ToolOptions;
}

// ── Module-level registry ───────────────────────────────────────────────
const registry = new Map<string, RegisteredTool>();

/** Register a tool so the agent loop can discover and call it. */
export function registerTool(
  name: string,
  schema: ChatToolDefinition,
  handler: ToolHandler,
  options: ToolOptions,
): void {
  registry.set(name, { name, schema, handler, options });
}

/** Look up a single tool by name. */
export function getTool(name: string): RegisteredTool | undefined {
  return registry.get(name);
}

/** Return every registered tool. */
export function getAllTools(): RegisteredTool[] {
  return Array.from(registry.values());
}

/** Return only the OpenAI-shaped schemas (for injection into the LLM prompt). */
export function getAllToolSchemas(): ChatToolDefinition[] {
  return getAllTools().map((t) => t.schema);
}

/** Return tools belonging to a given category. */
export function getToolsByCategory(category: ToolOptions['category']): RegisteredTool[] {
  return getAllTools().filter((t) => t.options.category === category);
}

/** Return tools that need user approval before execution. */
export function getToolsRequiringConfirmation(): RegisteredTool[] {
  return getAllTools().filter((t) => t.options.requiresConfirmation);
}
