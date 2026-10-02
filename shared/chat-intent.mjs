import { presentationDelivery } from './file-intent.mjs';

// Correct only image-command vocabulary for classification; retain the user's
// original subject, names, and requested visible text in the generation prompt.
function editDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_, i) => [i]);
  rows[0] = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
  }
  return rows[left.length][right.length];
}
const imageVocabulary = ['generate', 'create', 'make', 'design', 'draw', 'render', 'paint', 'illustrate', 'image', 'images', 'picture', 'pictures', 'photo', 'photos', 'illustration', 'artwork', 'wallpaper', 'logo', 'portrait', 'icon', 'icons', 'scene', 'scenes'];
export function normalizeImageIntent(message) {
  return String(message || '').replace(/\b[a-z]+\b/gi, word => {
    const token = word.toLowerCase();
    if (token === 'img' || token === 'imgs') return token === 'img' ? 'image' : 'images';
    if (token === 'pic' || token === 'pics') return token === 'pic' ? 'picture' : 'pictures';
    if (['general', 'generative', 'generator', 'generated', 'imagery'].includes(token)) return word;
    if (token.length < 4 || token.length > 15 || imageVocabulary.includes(token)) return word;
    const candidates = imageVocabulary.map(candidate => ({ candidate, distance: Math.abs(candidate.length - token.length) > 2 ? 3 : editDistance(token, candidate) }))
      .filter(({ candidate, distance }) => distance <= (candidate.length >= 7 ? 2 : 1)).sort((a, b) => a.distance - b.distance);
    return candidates.length && (candidates.length === 1 || candidates[0].distance < candidates[1].distance || candidates[0].candidate.replace(/s$/, '') === candidates[1].candidate.replace(/s$/, '')) ? candidates[0].candidate : word;
  });
}
// Classify the user's requested operation, never appended capability instructions.
export function isDiagramRequest(message) {
  const text = String(message || '').split('[SYSTEM DIRECTIVE:')[0];
  if (presentationDelivery(text)) return false;
  if (/\b(?:image|photo|picture|screenshot)\s+(?:of|showing)\b/i.test(text)) return false;
  return /\b(?:mind[ -]?maps?|mermaid|flowcharts?|diagrams?)\b/i.test(text)
    && (/\b(?:make|create|generate|draw|render|show|build|design|give|want|need)\b/i.test(text)
      || text.trim().split(/\s+/).length <= 12 && !/\b(?:debug|bug|error|syntax|install)\b/i.test(text));
}
export function isStudyRoadmapRequest(message) {
  const text = String(message || '').split('[SYSTEM DIRECTIVE:')[0];
  if (presentationDelivery(text) || /\b(?:without|no)\s+(?:diagrams?|mind[ -]?maps?|visuals?)\b/i.test(text)) return false;
  return /\b(?:study|learn|learning|prep|prepare|preparation)\b/i.test(text)
    && /\b(?:how|plan|roadmap|path|begin(?:ner|ning|ing)?|begging|advanced|from scratch|step by step)\b/i.test(text)
    && !/\b(?:write|generate|implement|debug|fix|refactor)\s+(?:a |the |my )?(?:code|function|program|script)\b/i.test(text);
}
export function requestedDiagramKind(message) {
  const text = String(message || '').replace(/\b(?:not|no|without)\s+(?:a |an )?(?:mind[ -]?map|flow\s*chart|mermaid(?:\s+diagram)?)/gi, '');
  if (/\bflow\s*charts?\b/i.test(text)) return 'flowchart';
  if (/\bmind[ -]?maps?\b/i.test(text)) return 'mindmap';
  if (/\bmermaid\b/i.test(text)) return 'flowchart';
  return isStudyRoadmapRequest(text) ? 'mindmap' : null;
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
