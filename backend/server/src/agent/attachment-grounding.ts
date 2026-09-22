import type { AgentAttachment } from './attachment-text.js';

const EXTERNAL_RESEARCH_REQUEST = /\b(?:search|browse|check|look\s*up|verify|research)\b[\s\S]{0,35}\b(?:web|internet|online|external|outside|other sources?)\b|\b(?:web|internet|online|external|outside)\b[\s\S]{0,35}\b(?:search|sources?|research|information)|\b(?:latest|today(?:'s)?|current news|recent news|live update)\b/i;
const EXTERNAL_RESEARCH_NEGATION = /\b(?:do not|don['’]?t|never|without|no)\b[\s\S]{0,24}\b(?:web|internet|online|external|outside|search|browse)\b/i;
const WHOLE_DOCUMENT_REQUEST = /\b(?:rate|rating|evaluate|critique|summari[sz]e|summary|analy[sz]e|analysis|review|overview|entire|whole|complete|all (?:slides?|pages?|sections?|questions?)|question bank|problem set|every question)\b/i;
const STOP_WORDS = new Set([
  'a', 'about', 'also', 'an', 'and', 'answer', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does',
  'explain', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'me', 'of', 'on', 'or', 'please', 'provide',
  'tell', 'that', 'the', 'their', 'this', 'to', 'what', 'when', 'where', 'which', 'who', 'why', 'with',
]);

export function requestsExternalResearch(message: string): boolean {
  return !EXTERNAL_RESEARCH_NEGATION.test(message) && EXTERNAL_RESEARCH_REQUEST.test(message);
}

export function shouldGroundToAttachments(message: string, attachments: AgentAttachment[] | undefined): boolean {
  return Boolean(attachments?.length) && !requestsExternalResearch(message);
}

export const ATTACHMENT_ONLY_INSTRUCTION = `ATTACHMENT-GROUNDED ANSWER:
- Answer from the attached file contents or attached image pixels only.
- Do not use web search, web images, outside sources, or unsupported background knowledge.
- Do not invent examples, numbers, formulas, identities, or details that are absent from the attachment, even as an illustration.
- Inspect attached images directly. Never replace an attached image with a visually similar web result.
- For an image, do not infer an exact person, product, vehicle model, engine, place, date, or specification from visual resemblance alone. Identify it exactly only when visible text or supplied attachment metadata establishes that identity; otherwise describe what is visible and state the limit.
- Cite slide, page, sheet, section, or filename labels that appear in the supplied context when useful.
- If a requested fact cannot be established from the attachment, say that it is not stated or not visually determinable from the attachment. Do not guess.`;

function queryTerms(message: string): string[] {
  return [...new Set((message.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
    .filter((term) => !STOP_WORDS.has(term)))];
}

function chunks(text: string): string[] {
  const sectionStarts = [...text.matchAll(/^(?:Slide|Page)\s+\d+\b.*$/gim)].map((match) => match.index || 0);
  if (sectionStarts.length > 1) {
    return sectionStarts.flatMap((start, index) => {
      const section = text.slice(start, sectionStarts[index + 1] ?? text.length).trim();
      const heading = section.split('\n')[0];
      if (section.length <= 3500) return [section];
      const parts: string[] = [];
      for (let offset = 0; offset < section.length; offset += 3200) parts.push(`${heading}\n${section.slice(offset, offset + 3500)}`);
      return parts;
    }).filter(Boolean);
  }
  const paragraphs = text.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  const result: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= 3_500) result.push(paragraph);
    else for (let offset = 0; offset < paragraph.length; offset += 3_200) result.push(paragraph.slice(offset, offset + 3_500));
  }
  return result;
}

function retrieveText(message: string, text: string): string {
  const limit = 28_000;
  if (text.length <= limit) return text;
  const units = chunks(text);
  // A review samples sections across the complete file, not just its opening.
  // Make coverage explicit so the model cannot claim exhaustive inspection.
  if (WHOLE_DOCUMENT_REQUEST.test(message)) {
    const count = Math.min(units.length, 16);
    const perUnit = Math.floor((limit - 400) / count);
    const indices = [...new Set(Array.from({ length: count }, (_, index) => Math.round(index * (units.length - 1) / Math.max(1, count - 1))))];
    return `[Overview retrieval: ${indices.length} representative passages across ${units.length} indexed passages. The full text remains searchable. State that this is a sampled review; do not claim every page was fully reviewed.]\n`
      + indices.map((index) => units[index].slice(0, perUnit)).join('\n\n');
  }
  const terms = queryTerms(message);
  if (terms.length === 0) return text.slice(0, 18_000);
  const ranked = units.map((value, index) => {
    const normalized = value.toLowerCase();
    const matches = terms.filter((term) => normalized.includes(term));
    const headingBonus = matches.some((term) => normalized.slice(0, 240).includes(term)) ? 2 : 0;
    return { index, score: matches.length * 3 + headingBonus, value };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.index - right.index);
  if (ranked.length === 0) return text.slice(0, 18_000);
  const selected = new Set<number>();
  let remaining = limit;
  const take = (index: number) => {
    if (index < 0 || index >= units.length || selected.has(index) || units[index].length + 2 > remaining) return;
    selected.add(index);
    remaining -= units[index].length + 2;
  };
  // Reserve space for strongest matches before adding surrounding context;
  // truncating after chronological sorting could drop the key final-page hit.
  for (const item of ranked.slice(0, 8)) take(item.index);
  for (const item of ranked.slice(0, 8)) {
    take(item.index - 1);
    take(item.index + 1);
  }
  return [...selected].sort((a, b) => a - b).map((index) => units[index]).join('\n\n');
}

export function retrieveAttachmentContext(message: string, attachments: AgentAttachment[] | undefined): string {
  return (attachments || [])
    .filter((attachment) => !attachment.type.toLowerCase().startsWith('image/'))
    .map((attachment) => {
      const safeName = attachment.name.replace(/[<>\r\n]/g, ' ').slice(0, 240);
      if (attachment.extractedText) {
        return `<attached_document name="${safeName}">\n${retrieveText(message, attachment.extractedText)}\n</attached_document>`;
      }
      return `<attached_document name="${safeName}" unreadable="true">${attachment.extractionError || 'No readable text was available.'}</attached_document>`;
    })
    .join('\n\n');
}
