import { describe, expect, it } from 'vitest';
import { detectCodeLanguage } from '../../../../../frontend/lib/code-language.js';
import { responsePhaseForEvent } from '../../../../../frontend/lib/response-stream.js';

describe('chat rendering regressions', () => {
  it('does not classify prompt prose mentioning function as JavaScript', () => {
    expect(detectCodeLanguage('You are an expert programmer. Write a function with clear documentation.')).toBe('text');
  });
  it('repairs the mislabelled Markdown prompt template in the reported case', () => {
    const prompt = 'You are an expert software engineer.\n\n### Problem statement\n{{TASK}}\n\n### Output\n- Include the function name.\n- **Readability**: use clear names.';
    expect(detectCodeLanguage(prompt, 'javascript')).toBe('markdown');
    expect(detectCodeLanguage(prompt)).toBe('markdown');
  });
  it('preserves explicit plain text and real code, including Markdown in template strings', () => {
    expect(detectCodeLanguage('const x = 1;', 'text')).toBe('text');
    expect(detectCodeLanguage('const content = `\n# Heading\n## Output\n- First\n- Second\n`;', 'js')).toBe('javascript');
    expect(detectCodeLanguage('def solve():\n    return 42')).toBe('python');
    expect(detectCodeLanguage('{"value":42}')).toBe('json');
    expect(detectCodeLanguage('Hello world', 'md')).toBe('markdown');
  });
  it('supports opening, resumed work, then answer without inventing a timer phase', () => {
    let phase = responsePhaseForEvent({ type: 'text' }, 'thinking');
    expect(phase).toBe('generating');
    phase = responsePhaseForEvent({ type: 'phase', phase: 'thinking' }, phase);
    expect(phase).toBe('thinking');
    expect(responsePhaseForEvent({ type: 'sources' }, phase)).toBe('thinking');
    expect(responsePhaseForEvent({ type: 'text' }, phase)).toBe('generating');
    expect(responsePhaseForEvent({ type: 'reset' }, 'generating')).toBe('thinking');
  });
});
