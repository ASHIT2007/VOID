import { describe, expect, it } from 'vitest';
import { presentationDelivery, requestedFileTools } from '@void/shared/file-intent.mjs';
import { isNaturalImageGeneration, isStudioCreationRequest } from '../components/ChatInterface.helpers';
describe('requested deliverable routing', () => {
  it.each(['Create Excel monthly sales', 'Generate a spreadsheet of expenses', 'Make a PowerPoint on solar energy', 'Create a PDF report', 'Create a Word document about how to use Excel'])('keeps %s on the file path', request => {
    expect(requestedFileTools(request).length).toBeGreaterThan(0);
    expect(isNaturalImageGeneration(request)).toBe(false);
    expect(isStudioCreationRequest(request)).toBe(false);
  });
  it('preserves all requested file formats', () => expect(requestedFileTools('Create a PowerPoint, Excel workbook and PDF report')).toEqual(['generate_presentation', 'generate_spreadsheet', 'generate_pdf']));
  it('does not confuse an attached source or the subject with another requested format', () => {
    expect(requestedFileTools('Create a Word document about how to use Excel')).toEqual(['generate_document']);
    expect(requestedFileTools('Create a PDF report from the attached Excel file')).toEqual(['generate_pdf']);
  });
  it.each(['Create a mind map', 'Generate a Mermaid diagram', 'Make a chart'])('does not turn %s into an image', request => expect(isNaturalImageGeneration(request)).toBe(false));
  it.each(['Create an image of a cat', 'Draw a cat', 'Make an illustration for my PowerPoint'])('preserves image requests: %s', request => {
    expect(requestedFileTools(request)).toEqual([]); expect(isNaturalImageGeneration(request)).toBe(true);
  });
  it('keeps preview-only presentation and explanatory requests available', () => {
    expect(requestedFileTools('Make a PowerPoint about science, preview only')).toEqual([]);
    expect(isStudioCreationRequest('Make a PowerPoint about science, preview only')).toBe(true);
    expect(requestedFileTools('How to create a PDF?')).toEqual([]);
  });
  it.each([
    'Generate a PPT about solar energy', 'genrate a ppt on solar energy', 'Make a presentation on solar energy',
    'Design a slide deck about solar energy', 'Create 5 slides about solar energy', 'PPT on solar energy',
    'Make a PowerPoint about solar energy and show a preview', 'Create a PowerPoint with preview too',
    'Download a .pptx about solar energy with a preview', 'Make a PPT, no preview',
  ])('uses the presentation skill and editable preview for %s', request => {
    expect(presentationDelivery(request)).toBe('preview'); expect(requestedFileTools(request)).toEqual([]);
    expect(isStudioCreationRequest(request)).toBe(true); expect(isNaturalImageGeneration(request)).toBe(false);
  });
  it.each(['Make a PowerPoint about solar energy', 'Download a .pptx about solar energy', 'Create a PowerPoint without a preview', "Create a PowerPoint, don't show a preview", "Create a PowerPoint, don't show me a preview", 'Make a PowerPoint, no preview', 'Make a presentation about solar energy as a PowerPoint'])('creates an actual PowerPoint only for %s', request => {
    expect(presentationDelivery(request)).toBe('powerpoint'); expect(requestedFileTools(request)).toEqual(['generate_presentation']);
    expect(isStudioCreationRequest(request)).toBe(false);
  });
  it('does not let topic context or transport instructions switch preview delivery', () => {
    expect(presentationDelivery('Make a presentation about PowerPoint features')).toBe('preview');
    expect(presentationDelivery('Make a presentation, not a PowerPoint')).toBe('preview');
    expect(requestedFileTools('Make a PPT\n\nArtifact requirements: Create a PowerPoint')).toEqual([]);
    expect(requestedFileTools('Make a PPT\n\nTopic context from the latest relevant conversation turn: Create a PowerPoint')).toEqual([]);
    expect(presentationDelivery('Explain how to make a PPT')).toBeNull();
    expect(presentationDelivery('Review this PowerPoint')).toBeNull();
    expect(presentationDelivery('Create a mind map about PowerPoint')).toBeNull();
    expect(presentationDelivery('Create a report about PowerPoint')).toBeNull();
  });
});
