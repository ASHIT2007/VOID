import type { PresentationData } from '@/types/presentation';

function plainText(value: string, limit = 110): string {
  const text = value.replace(/<[^>]*>/g, '').replace(/[*`]/g, '').replace(/^\s*#{1,6}\s+/, '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text;
}

export function presentationSummary(data: PresentationData): string {
  const title = plainText(data.title || 'Untitled presentation');
  const topics = [...new Set(data.slides.filter(slide => slide.layout !== 'references'
    && !/^(?:sources?|references?|bibliography|thank you|questions|conclusion)$/i.test(slide.title.trim()))
    .map(slide => plainText(slide.title, 65)).filter(topic => topic && topic.toLowerCase() !== title.toLowerCase()))].slice(0, 4);
  const coverage = topics.length > 1 ? `${topics.slice(0, -1).join(', ')} and ${topics[topics.length - 1]}` : topics[0];
  return `I created a ${data.slides.length}-slide presentation titled “${title}”.${coverage ? ` It covers ${coverage}.` : ''}`;
}

/** Also supplies a brief for older decks and client-side recovery paths. */
export function ensurePresentationBrief(content: string, data: PresentationData): string {
  const summary = presentationSummary(data);
  if (content.startsWith(summary)) return content;
  const cleaned = content.replace(/^\s*Here(?:'s| is) your presentation[:.!]?\s*/i, '')
    .replace(/^I created a \d+-slide presentation[^\n]*\n\n/i, '');
  return `${summary}\n\n${cleaned.trim()}`;
}
