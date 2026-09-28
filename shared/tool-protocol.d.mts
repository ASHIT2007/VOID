export interface TextToolCall { name: string; arguments: Record<string, unknown> }
export const TOOL_NAMES: string[];
export function requestsToolExample(prompt?: string): boolean;
export function extractToolProtocol(text: string, options?: { streaming?: boolean; knownToolNames?: string[]; preserveExamples?: boolean }): {
  text: string; calls: TextToolCall[]; hasProtocol: boolean; incomplete: boolean; invalid: boolean;
};
