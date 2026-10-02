import { describe, expect, it } from 'vitest';
import { isNaturalImageGeneration } from '../components/ChatInterface.helpers';
import { normalizeImageIntent } from '@void/shared/chat-intent.mjs';

describe('image requests with spelling mistakes', () => {
  it.each(['genrate an iamge of Sasukae', 'generte a pictrue of a cyberpunk cityy', 'gnerate an imge of a black hole', 'genertae a photp of a castle', 'Can you cretae an img of a red panda?', 'Please genreate a picture of a nebula', 'make an imags of space'])('uses image generation for %s', request => {
    expect(isNaturalImageGeneration(request)).toBe(true);
  });
  it.each(['Explain how to generate images', 'Can you explain image generators?', 'Do not generate an image', 'Create a flowchart of image generation', 'Make a PowerPoint about image generation', 'Write Python code to generate an image', 'General image editing advice', 'Generative image models'])('keeps non-image tasks on the proper path for %s', request => {
    expect(isNaturalImageGeneration(request)).toBe(false);
  });
  it('normalizes commands for classification without rewriting subject names', () => {
    expect(normalizeImageIntent('genertae an iamge of Sasukae in a cityy')).toBe('generate an image of Sasukae in a cityy');
  });
});
