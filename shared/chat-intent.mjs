import { presentationDelivery } from './file-intent.mjs';
// Classify the user's requested operation, never appended capability instructions.
export function isDiagramRequest(message) {
  const text = String(message || '').split('[SYSTEM DIRECTIVE:')[0];
  if (presentationDelivery(text)) return false;
  if (/\b(?:image|photo|picture|screenshot)\s+(?:of|showing)\b/i.test(text)) return false;
  return /\b(?:mind[ -]?maps?|mermaid|flowcharts?|diagrams?)\b/i.test(text)
    && /\b(?:make|create|generate|draw|render|show|build|design|give|want|need)\b/i.test(text);
}
export function workspaceInspectionTools(message) {
  const text = String(message || '').split('[SYSTEM DIRECTIVE:')[0];
  const tools = [];
  if (/\b(?:cost|spent|spend|usage|tokens?|billing)\b/i.test(text)
    && /\b(?:conversations?|chats?|tokens?|usage|VOID)\b|\b(?:my|our)\s+(?:costs?|spend(?:ing)?|bill(?:ing)?)\b/i.test(text)
    && !/\b(?:create|write|generate|build|implement|design)\b/i.test(text)) tools.push('usage_tracker');
  if (/\b(?:models?|providers?|routing)\b/i.test(text)
    && /\b(?:connected|configured|routing|VOID)\b|\b(?:my|our)\s+(?:models?|providers?)\b/i.test(text)
    && !/\b(?:switch|select|use|change|set|connect|add|create|build|implement)\b/i.test(text)) tools.push('provider_router');
  return tools;
}
