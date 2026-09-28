import { describe, expect, it } from 'vitest';
import { extractToolProtocol, requestsToolExample } from '@void/shared/tool-protocol.mjs';

const reportedCall = '<tool_call> <function=web_search> <parameter=includeImages> false </parameter> <parameter=maxResults> 10.0 </parameter> <parameter=query> Shisui Uchiha Kotoamatsukami Kamui jutsu </parameter> <parameter=searchDepth> advanced </parameter> </function> </tool_call>';

describe('text-form tool protocol', () => {
  it('recovers the exact reported search as typed arguments instead of answer text', () => {
    const result = extractToolProtocol(reportedCall);
    expect(result.text.trim()).toBe('');
    expect(result.calls).toEqual([{ name: 'web_search', arguments: { includeImages: false, maxResults: 10,
      query: 'Shisui Uchiha Kotoamatsukami Kamui jutsu', searchDepth: 'advanced' } }]);
    expect(result.invalid || result.incomplete).toBe(false);
  });

  it('never flashes a control tag even when every character arrives separately', () => {
    const response = `Searching now. ${reportedCall}Here is the answer.`;
    let streamed = '';
    let previous = '';
    for (const character of response) {
      streamed += character;
      const visible = extractToolProtocol(streamed, { streaming: true }).text;
      expect(visible.startsWith(previous)).toBe(true);
      expect(visible).not.toMatch(/<|parameter=|function=/);
      previous = visible;
    }
    expect(previous).toBe('Searching now. Here is the answer.');
  });

  it('preserves fenced, inline and quoted examples and ordinary HTML', () => {
    for (const text of [`\`\`\`xml\n${reportedCall}\n\`\`\``, `Example: \`${reportedCall}\``, `> ${reportedCall}`,
      '<table><tr><td>Result</td></tr></table>', 'Use < to compare numbers.']) {
      expect(extractToolProtocol(text).text).toBe(text);
      expect(extractToolProtocol(text).calls).toEqual([]);
    }
  });

  it('keeps multiple calls and decodes entities without evaluating values', () => {
    const call = '<tool_call><function=calculator><parameter=expression>2 &lt; 3 &amp;&amp; 4 &gt; 1</parameter></function></tool_call>';
    expect(extractToolProtocol(call + reportedCall).calls).toHaveLength(2);
    expect(extractToolProtocol(call).calls[0].arguments.expression).toBe('2 < 3 && 4 > 1');
  });

  it('fails closed on incomplete and malformed protocol, including truncated opening tags', () => {
    for (const text of ['<tool_call><function=web_search>', '<tool_call', '<tool_c']) {
      const result = extractToolProtocol(text);
      expect(result.incomplete).toBe(true);
      expect(result.text).toBe('');
    }
    for (const body of ['<function=web_search>unexpected</function>', '<function=web_search><parameter=__proto__>{}</parameter></function>',
      '<function=web_search><parameter=query>one</parameter><parameter=query>two</parameter></function>']) {
      expect(extractToolProtocol(`<tool_call>${body}</tool_call>`).invalid).toBe(true);
    }
  });

  it('recovers raw JSON tool call arrays without leaking into visible text', () => {
    const raw = '[ {"action": "web_search", "query": "Satoru Gojo Jujutsu Kaisen character"} {"action": "web_search", "query": "Satoru Gojo Jujutsu Kaisen character"} ] Satoru Gojo is a fictional character';
    const result = extractToolProtocol(raw);
    expect(result.text.trim()).toBe('Satoru Gojo is a fictional character');
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]).toEqual({ name: 'web_search', arguments: { query: 'Satoru Gojo Jujutsu Kaisen character' } });
    expect(result.hasProtocol).toBe(true);
  });

  it('recovers standalone JSON tool calls and preserves code fences', () => {
    const raw = '{"action": "calculator", "expression": "42 * 2"} The answer is computed.';
    const result = extractToolProtocol(raw);
    expect(result.text.trim()).toBe('The answer is computed.');
    expect(result.calls).toEqual([{ name: 'calculator', arguments: { expression: '42 * 2' } }]);

    const fenced = '```json\n{"action": "web_search", "query": "preserved"}\n```';
    expect(extractToolProtocol(fenced, { preserveExamples: true }).text).toBe(fenced);
    expect(extractToolProtocol(fenced, { preserveExamples: true }).calls).toHaveLength(0);
  });

  it('recovers the exact reported Uchiha search with token glitch prefix { "tool{ "tool": ...', () => {
    const raw = '{ "tool{ "tool": "web_search", "arguments": { "query": "Uchiha clan members Mangekyou Sharingan minimal screen time anime manga", "max_results": 10 } }';
    const result = extractToolProtocol(raw);
    expect(result.text.trim()).toBe('');
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toEqual({
      name: 'web_search',
      arguments: {
        query: 'Uchiha clan members Mangekyou Sharingan minimal screen time anime manga',
        max_results: 10,
      },
    });
    expect(result.hasProtocol).toBe(true);
    expect(result.incomplete).toBe(false);
  });

  it('suppresses streaming text for glitched and nested tool calls character-by-character', () => {
    const raw = '{ "tool{ "tool": "web_search", "arguments": { "query": "Uchiha clan members Mangekyou Sharingan", "max_results": 10 } }';
    let streamed = '';
    for (const char of raw) {
      streamed += char;
      const visible = extractToolProtocol(streamed, { streaming: true }).text;
      // At no point should any tool call or glitched JSON fragment appear in visible text
      expect(visible).toBe('');
    }
  });

  it('recovers nested arguments, stringified arguments, and standard OpenAI function wrapper', () => {
    const fnWrap = '{"type": "function", "function": {"name": "web_search", "arguments": "{\\"query\\": \\"Itachi Uchiha\\"}"}}';
    const resWrap = extractToolProtocol(fnWrap);
    expect(resWrap.text.trim()).toBe('');
    expect(resWrap.calls).toEqual([{ name: 'web_search', arguments: { query: 'Itachi Uchiha' } }]);

    const argsObj = '{"name": "calculator", "args": {"expression": "25 * 4"}} Result follows.';
    const resArgs = extractToolProtocol(argsObj);
    expect(resArgs.text.trim()).toBe('Result follows.');
    expect(resArgs.calls).toEqual([{ name: 'calculator', arguments: { expression: '25 * 4' } }]);
  });

  it('recovers the exact fenced JSON screenshot as an operation, never as answer code', () => {
    const screenshot = '```json\n{\n  "type": "web_search",\n  "query": "Satoru Gojo Jujutsu Kaisen character overview"\n}\n```';
    expect(extractToolProtocol(screenshot)).toMatchObject({ text: '', hasProtocol: true, incomplete: false, invalid: false,
      calls: [{ name: 'web_search', arguments: { query: 'Satoru Gojo Jujutsu Kaisen character overview' } }] });
    for (let i = 1; i <= screenshot.length; i++) expect(extractToolProtocol(screenshot.slice(0, i), { streaming: true }).text).toBe('');
  });

  it('handles common provider wrappers, call arrays, field order and future registered tools', () => {
    const calls = [
      '{"query":"Gojo","type":"web_search"}',
      '{"functionCall":{"name":"web_search","args":{"query":"Gojo"}}}',
      '{"type":"tool_use","name":"web_search","input":{"query":"Gojo"}}',
      '{"tool_calls":[{"type":"function","function":{"name":"web_search","arguments":"{\\"query\\":\\"Gojo\\"}"}}]}',
      '[TOOL_CALLS][{"name":"web_search","arguments":{"query":"Gojo"}}]',
      '{"name":"functions.web_search","arguments":{"query":"Gojo"}}',
      '{"tool_name":"web_search","parameters":{"query":"Gojo"}}',
      '~~~~json\n{"type":"web_search","query":"Gojo"}\n~~~~',
    ];
    for (const raw of calls) {
      expect(extractToolProtocol(raw).calls).toEqual([{ name: 'web_search', arguments: { query: 'Gojo' } }]);
      expect(extractToolProtocol(raw).text).toBe('');
      for (let i = 1; i <= raw.length; i++) expect(extractToolProtocol(raw.slice(0, i), { streaming: true }).text).toBe('');
    }
    expect(extractToolProtocol('```json\n{"type":"future_skill","document":"one"}\n```', { knownToolNames: ['future_skill'] }).calls)
      .toEqual([{ name: 'future_skill', arguments: { document: 'one' } }]);
  });

  it('preserves ordinary JSON, chart artifacts and deliberately requested tool examples', () => {
    for (const raw of ['{"name":"Alice","type":"person"}', '{"action":"save","label":"Save"}', '```json\n{"type":"bar","data":[1,2]}\n```', '```chart\n{"type":"bar","bars":[]}\n```']) {
      expect(extractToolProtocol(raw).text).toBe(raw); expect(extractToolProtocol(raw).calls).toEqual([]);
    }
    const example = '```json\n{"type":"web_search","query":"Gojo"}\n```';
    expect(requestsToolExample('Show an example JSON tool call for web_search')).toBe(true);
    expect(requestsToolExample('tell me about satoru gojo')).toBe(false);
    expect(requestsToolExample('Show a JSON example for weather_fetch')).toBe(true);
    expect(extractToolProtocol(example, { preserveExamples: true }).text).toBe(example);
  });

  it('does not expose incomplete or malformed fenced or raw operation JSON', () => {
    for (const raw of ['{"type":"web_search","query":}', '{"type":"web_search","query":', '```json\n{"type":"web_search","query":}\n```', '```json\n{"type":"web_search","query":"Gojo"}', '[TOOL_CALLS][{"name":"unavailable_action","arguments":{}}]']) {
      const result = extractToolProtocol(raw); expect(result.text).toBe('');
      expect(result.hasProtocol).toBe(true); expect(result.invalid || result.incomplete).toBe(true);
    }
  });
});
