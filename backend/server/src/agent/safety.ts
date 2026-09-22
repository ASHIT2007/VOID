import { getTool } from './tool-registry.js';

export const BLOCKED_DOMAINS: string[] = [
  'pinterest.com',
  'quora.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com'
];

export interface Source {
  index: number;
  url: string;
  title: string;
  snippet: string;
}

/**
 * Checks if a tool is a write action requiring confirmation.
 */
export function isWriteAction(toolName: string): boolean {
  const tool = getTool(toolName);
  if (!tool) return false;
  return tool.options?.requiresConfirmation === true;
}

/**
 * Verifies that all citations in the text map to an actual source.
 * Removes hallucinated citations.
 */
export function verifyCitations(text: string, sources: Source[]): string {
  const sourceIndices = new Set(sources.map(s => s.index.toString()));
  
  // Replace [N] with empty string if N is not in sourceIndices
  return text.replace(/\[(\d+)\]/g, (match, index) => {
    if (sourceIndices.has(index)) {
      return match;
    }
    return '';
  });
}

/**
 * Checks if a given URL belongs to a blocked domain.
 */
export function isBlockedDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return BLOCKED_DOMAINS.some(domain => hostname.includes(domain) || hostname === domain);
  } catch {
    return false; // Invalid URL, maybe handle differently, but false is safe
  }
}
