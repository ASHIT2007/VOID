import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { enrichAttachmentsWithText, extractAttachmentText } from '../../agent/attachment-text.js';

describe('attachment text extraction', () => {
  it('extracts plain text attachments', async () => {
    const text = await extractAttachmentText(
      { name: 'notes.txt', type: 'text/plain' },
      Buffer.from('Important review notes'),
    );
    expect(text).toBe('Important review notes');
  });

  it('extracts slide text from PPTX files in slide order', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide2.xml', '<p:sld><a:t>Second slide</a:t><a:t>Revenue increased</a:t></p:sld>');
    zip.file('ppt/slides/slide1.xml', '<p:sld><a:t>Quarterly Review</a:t><a:t>Executive summary</a:t></p:sld>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const text = await extractAttachmentText(
      {
        name: 'review.pptx',
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
      buffer,
    );

    expect(text).toContain('Slide 1\nQuarterly Review\nExecutive summary');
    expect(text).toContain('Slide 2\nSecond slide\nRevenue increased');
    expect(text.indexOf('Quarterly Review')).toBeLessThan(text.indexOf('Second slide'));
  });

  it('removes raw document base64 after extracting it', async () => {
    const [attachment] = await enrichAttachmentsWithText([{
      name: 'brief.md',
      type: 'text/markdown',
      base64: Buffer.from('# Product brief').toString('base64'),
    }]);

    expect(attachment.base64).toBeUndefined();
    expect(attachment.extractedText).toBe('# Product brief');
    expect(attachment.extractionError).toBeUndefined();
  });

  it('preserves question-bank text beyond the old 30k cutoff', async () => {
    const source = `${'Question material. '.repeat(2_400)}\n50. Final question`;
    const text = await extractAttachmentText({ name: 'question-bank.txt', type: 'text/plain' }, Buffer.from(source));
    expect(text).toContain('50. Final question');
    expect(text).not.toContain('[Attachment text truncated]');
  });

  it('reports unsupported legacy PowerPoint files instead of pretending they were read', async () => {
    const [attachment] = await enrichAttachmentsWithText([{
      name: 'legacy.ppt',
      type: 'application/vnd.ms-powerpoint',
      base64: Buffer.from('legacy binary data').toString('base64'),
    }]);

    expect(attachment.extractedText).toBeUndefined();
    expect(attachment.extractionError).toMatch(/unsupported attachment type/i);
  });
});
