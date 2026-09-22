import { describe, expect, it } from 'vitest';
import { answerDepthInstruction, effortAnswerInstruction } from '../../agent/effort-policy.js';

describe('answer depth policy', () => {
  it('gives open-ended entity lookups a useful coverage floor', () => {
    expect(answerDepthInstruction('who is naruto')).toContain('180-350 words');
    expect(answerDepthInstruction('Tell me about Ada Lovelace')).toContain('Do not stop after a single summary paragraph');
  });

  it('honors explicit brevity and leaves narrow calculations alone', () => {
    expect(answerDepthInstruction('Briefly, who is Naruto?')).toBe('');
    expect(answerDepthInstruction('What is 12 * 8?')).toBe('');
  });
});

describe('effort answer depth', () => {
  it('makes Tenebrae explicitly more descriptive than lower modes', () => {
    expect(effortAnswerInstruction('high', 'Explain black holes')).toContain('more complete and descriptive');
    expect(effortAnswerInstruction('medium', 'Explain black holes')).toContain('balanced');
    expect(effortAnswerInstruction('low', 'Explain black holes')).toContain('concisely');
  });

  it('honors explicit brevity at every effort', () => {
    expect(effortAnswerInstruction('high', 'Briefly explain black holes')).toContain('requested brevity');
  });
});
