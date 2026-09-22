import { describe, expect, it } from 'vitest';
import { requestsExternalResearch, retrieveAttachmentContext, shouldGroundToAttachments } from '../../agent/attachment-grounding.js';

const ppt = [{
  name: 'course-rules.pptx',
  type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  extractedText: [
    'Slide 1\nWelcome and attendance policy',
    'Slide 2\nCGPA is calculated from grade points weighted by course credits.',
    'Slide 3\nLibrary hours and campus facilities',
  ].join('\n\n'),
}];

describe('attachment-grounded retrieval', () => {
  it('keeps ordinary image and document questions attachment-only', () => {
    expect(shouldGroundToAttachments('Tell me about this car and its engine', [{ name: 'car.png', type: 'image/png' }])).toBe(true);
    expect(shouldGroundToAttachments('Summarize this and explain CGPA', ppt)).toBe(true);
    expect(shouldGroundToAttachments('Analyze the attached image. Do not search the web.', [{ name: 'car.png', type: 'image/png' }])).toBe(true);
    expect(requestsExternalResearch('find CGPA in this presentation')).toBe(false);
  });

  it('allows external research only when the user clearly requests it', () => {
    expect(shouldGroundToAttachments('Search the web and compare this presentation with the latest rules', ppt)).toBe(false);
    expect(requestsExternalResearch('verify this using external sources')).toBe(true);
  });

  it('retrieves relevant slide passages for focused questions', () => {
    const long = [{ ...ppt[0], extractedText: `${ppt[0].extractedText}\n\n${'Slide 9\nUnrelated campus notice.\n\n'.repeat(900)}` }];
    const context = retrieveAttachmentContext('How is CGPA calculated?', long);
    expect(context).toContain('CGPA is calculated');
    expect(context).not.toContain('Slide 9\nUnrelated campus notice'.repeat(20));
  });

  it('preserves the whole extracted file for summary requests', () => {
    const context = retrieveAttachmentContext('Analyze and summarize this presentation', ppt);
    expect(context).toContain('Slide 1');
    expect(context).toContain('Slide 3');
  });

  it('finds relevant evidence after the old extraction cutoff', () => {
    const extractedText = Array.from({ length: 500 }, (_, index) => `Page ${index + 1}\n${'Routine topic description. '.repeat(20)}`).join('\n\n')
      + '\n\nPage 501\nThe unique graduation code is QUARTZ-847.';
    const context = retrieveAttachmentContext('What is the unique graduation code?', [{ ...ppt[0], extractedText }]);
    expect(context).toContain('QUARTZ-847');
    expect(context.length).toBeLessThan(31_000);
  });

  it('reviews representative sections from beginning to end with honest coverage', () => {
    const extractedText = Array.from({ length: 200 }, (_, index) => `Page ${index + 1}\n${'Technical course notes. '.repeat(100)}`).join('\n\n');
    const context = retrieveAttachmentContext('rate these notes', [{ ...ppt[0], extractedText }]);
    expect(context).toContain('Page 1\n');
    expect(context).toContain('Page 200\n');
    expect(context).toContain('sampled review');
    expect(context.length).toBeLessThan(29_000);
  });
});
