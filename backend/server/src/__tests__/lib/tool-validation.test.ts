import { describe, it, expect } from 'vitest';
import { validateToolArguments } from '../../lib/tool-validation.js';
const schema = { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'number', minimum: 1, maximum: 12 }, includeImages: { type: 'boolean' }, searchDepth: { type: 'string', enum: ['basic', 'advanced'] } }, required: ['query'], additionalProperties: false };
describe('tool argument boundary', () => {
  it('repairs schema-matching aliases and typed values without changing string content', () => {
    expect(validateToolArguments({ query: 'Gojo', max_results: '10', include_images: 'false', search_depth: 'advanced' }, schema).args)
      .toEqual({ query: 'Gojo', maxResults: 10, includeImages: false, searchDepth: 'advanced' });
    expect(validateToolArguments({ query: '{"untrusted":"data"}' }, schema).args?.query).toBe('{"untrusted":"data"}');
    expect(validateToolArguments({ value: '10' }, { type: 'object', properties: { value: { type: ['string', 'number'] } } }).args?.value).toBe('10');
  });
  it('rejects missing, malformed, out-of-range, duplicate and unknown arguments', () => {
    for (const args of [{}, { query: 5 }, { query: 'Gojo', maxResults: 99 }, { query: 'Gojo', searchDepth: 'secret' }, { query: 'Gojo', max_results: 5, maxResults: 6 }, { query: 'Gojo', injected: true }]) {
      expect(validateToolArguments(args, schema).error).toBeTruthy();
    }
  });
  it('validates nested arrays and rejects prototype keys before execution', () => {
    const nested = { type: 'object', properties: { points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] } } }, required: ['points'] };
    expect(validateToolArguments({ points: '[{"x":"2"}]' }, nested).args).toEqual({ points: [{ x: 2 }] });
    expect(validateToolArguments(JSON.parse('{"query":"Gojo","__proto__":{}}'), schema).error).toMatch(/unsafe/);
    expect(validateToolArguments({ points: [{ x: 'broken' }] }, nested).error).toMatch(/number/);
  });
});
