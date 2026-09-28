// A few providers emit function calls as text instead of structured tool_calls.
// Keep that control protocol out of answers, while preserving code examples.
export const TOOL_NAMES = ['web_search', 'web_fetch', 'news_search', 'academic_search', 'image_search', 'generate_image', 'edit_image', 'calculator', 'code_execution', 'file_read', 'file_write', 'memory_set', 'memory_get', 'memory_delete', 'memory_list', 'conversation_search', 'weather_fetch', 'currency_convert', 'stock_quote', 'maps_search', 'render_diagram', 'render_chart', 'tool_search', 'generate_document', 'generate_spreadsheet', 'generate_presentation', 'generate_pdf', 'usage_tracker', 'provider_router'];

export function requestsToolExample(prompt = '') {
  return /\b(?:example|sample|schema|payload|syntax|format|json|xml|code|tutorial)\b/i.test(prompt)
    && (/\b(?:tool[_ -]?(?:call|use|protocol)|function[_ -]?call|api request|api payload)\b/i.test(prompt)
      || TOOL_NAMES.some(name => new RegExp(`\\b${name}\\b`, 'i').test(prompt)));
}
function isLiteral(text, index) {
  const prefix = text.slice(0, index);
  let fence = null;
  for (const match of prefix.matchAll(/^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$/gm)) {
    if (!fence) fence = match[1][0];
    else if (match[1][0] === fence) fence = null;
  }
  const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
  return Boolean(fence) || /^\s*>/.test(line) || (line.match(/`/g) || []).length % 2 === 1;
}

function decode(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  })[entity]);
}

function parseCall(block) {
  const fn = block.match(/^\s*<function=([\w.-]+)>\s*([\s\S]*?)\s*<\/function>\s*$/i);
  if (!fn) return null;
  const args = Object.create(null);
  const parameters = /<parameter=([\w.-]+)>\s*([\s\S]*?)\s*<\/parameter>/gi;
  for (const parameter of fn[2].matchAll(parameters)) {
    if (['__proto__', 'constructor', 'prototype'].includes(parameter[1]) || Object.hasOwn(args, parameter[1])) return null;
    const value = decode(parameter[2].trim());
    try { args[parameter[1]] = JSON.parse(value); }
    catch { args[parameter[1]] = value; }
  }
  if (fn[2].replace(parameters, '').trim()) return null;
  return { name: fn[1], arguments: args };
}

function normalizeJsonToolCall(obj, knownTools) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  // Support OpenAI function calling structure: { type: "function", function: { name: "...", arguments: ... } }
  if (obj.type === 'function' && obj.function && typeof obj.function === 'object') {
    return normalizeJsonToolCall({ ...obj.function, tool: obj.function.name }, knownTools);
  }
  // Support nested tool wrapper: { tool: { name: "...", arguments: ... } }
  if (obj.tool && typeof obj.tool === 'object' && !Array.isArray(obj.tool)) {
    return normalizeJsonToolCall({ ...obj.tool, tool: obj.tool.name }, knownTools);
  }
  // Support nested call wrapper: { call: { name: "...", arguments: ... } }
  if (obj.call && typeof obj.call === 'object' && !Array.isArray(obj.call)) {
    return normalizeJsonToolCall({ ...obj.call, tool: obj.call.name }, knownTools);
  }

  if (obj.functionCall && typeof obj.functionCall === 'object') return normalizeJsonToolCall({ ...obj.functionCall, tool: obj.functionCall.name }, knownTools);

  const rawName = obj.action || obj.name || obj.tool || obj.tool_name || (knownTools.has(String(obj.type).replace(/^functions[.:]/, '')) ? obj.type : undefined);
  const name = typeof rawName === 'string' && knownTools.has(rawName.replace(/^functions[.:]/, '')) ? rawName.replace(/^functions[.:]/, '') : rawName;
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(name)) return null;
  if (!knownTools.has(name) && typeof obj.tool !== 'string' && typeof obj.tool_name !== 'string' && obj.type !== 'tool_use') return null;

  let args = {};
  const rawArgs = obj.arguments !== undefined ? obj.arguments
    : obj.parameters !== undefined ? obj.parameters
    : obj.args !== undefined ? obj.args
    : obj.input !== undefined && obj.type === 'tool_use' ? obj.input
    : undefined;

  if (rawArgs !== undefined) {
    if (typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)) {
      args = rawArgs;
    } else if (typeof rawArgs === 'string') {
      try {
        const parsed = JSON.parse(rawArgs);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed;
        } else {
          args = { input: rawArgs };
        }
      } catch {
        args = { input: rawArgs };
      }
    }
  } else {
    for (const [key, val] of Object.entries(obj)) {
      if (!['action', 'name', 'tool', 'tool_name', 'type', 'id', 'call_id', 'thought'].includes(key)) {
        args[key] = val;
      }
    }
  }
  return { name, arguments: args };
}

function extractBalancedBlock(text, startIndex) {
  const openChar = text[startIndex];
  const closeChar = openChar === '{' ? '}' : openChar === '[' ? ']' : null;
  if (!closeChar) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === openChar) {
        depth++;
      } else if (char === closeChar) {
        depth--;
        if (depth === 0) {
          return {
            raw: text.slice(startIndex, i + 1),
            start: startIndex,
            end: i + 1,
          };
        }
      }
    }
  }
  return null;
}

function extractJsonCalls(text, { streaming = false, knownTools = new Set(TOOL_NAMES) } = {}) {
  let visible = text;
  const calls = [];
  let hasProtocol = false;
  let incomplete = false;
  let invalid = false;
  const signature = raw => /"(?:tool|tool_calls|functionCall)"\s*:/.test(raw)
    || [...knownTools].some(name => new RegExp(`"(?:type|action|name)"\\s*:\\s*"${name}"`).test(raw));

  // 1. First, search for arrays of tool calls: e.g. `[ { "action": ... }, ... ]` or `[ { "action": ... } { "action": ... } ]`
  const arrayRegex = /\[\s*\{\s*"/g;
  let arrMatch;
  while ((arrMatch = arrayRegex.exec(visible)) !== null) {
    if (isLiteral(visible, arrMatch.index)) continue;
    const block = extractBalancedBlock(visible, arrMatch.index);
    if (!block) break; // unclosed array

    let extracted = [];
    try {
      const parsed = JSON.parse(block.raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const call = normalizeJsonToolCall(item, knownTools);
          if (call) extracted.push(call);
        }
      }
    } catch {
      // Missing commas between objects in array: `[ {...} {...} ]`
      const innerRegex = /\{\s*"/g;
      let innerMatch;
      while ((innerMatch = innerRegex.exec(block.raw)) !== null) {
        const innerBlock = extractBalancedBlock(block.raw, innerMatch.index);
        if (innerBlock) {
          try {
            const parsed = JSON.parse(innerBlock.raw);
            const call = normalizeJsonToolCall(parsed, knownTools);
            if (call) extracted.push(call);
          } catch {}
          innerRegex.lastIndex = innerBlock.end;
        }
      }
    }

    if (extracted.length > 0) {
      hasProtocol = true;
      calls.push(...extracted);
      visible = visible.slice(0, block.start) + visible.slice(block.end);
      arrayRegex.lastIndex = block.start;
    }
  }

  // 2. Search for individual JSON tool calls
  // Match candidate tool call opening: `{"action":` or `{"tool":` or `{"name":` etc.
  const singleRegex = /\{\s*"/g;
  let singleMatch;
  while ((singleMatch = singleRegex.exec(visible)) !== null) {
    if (isLiteral(visible, singleMatch.index)) continue;
    const block = extractBalancedBlock(visible, singleMatch.index);
    if (!block) continue; // might be unclosed, handled in streaming check

    try {
      const parsed = JSON.parse(block.raw);
      const wrappedCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls.map(item => normalizeJsonToolCall(item, knownTools)) : null;
      const call = normalizeJsonToolCall(parsed, knownTools);
      if (call || wrappedCalls?.length && wrappedCalls.every(Boolean)) {
        hasProtocol = true;
        calls.push(...(call ? [call] : wrappedCalls));

        let cutStart = block.start;
        // Check if there is a broken prefix preceding the tool call, e.g. `{ "tool` in `{ "tool{ "tool": ... }`
        const prefix = visible.slice(0, cutStart);
        const prefixMatch = prefix.match(/(?:\{\s*"?\w+"?\s*|```(?:json)?\s*|<tool_call\s*>\s*)$/i);
        if (prefixMatch && !isLiteral(visible, prefix.length - prefixMatch[0].length)) {
          cutStart -= prefixMatch[0].length;
        }

        let cutEnd = block.end;
        if (prefixMatch) {
          const suffix = visible.slice(cutEnd);
          const suffixMatch = suffix.match(/^(?:\s*```|\s*\}\s*|\s*<\/tool_call>)/i);
          if (suffixMatch) {
            cutEnd += suffixMatch[0].length;
          }
        }

        visible = visible.slice(0, cutStart) + visible.slice(cutEnd);
        singleRegex.lastIndex = cutStart;
        continue;
      }
    } catch {
      if (signature(block.raw)) {
        hasProtocol = true; invalid = true;
        visible = visible.slice(0, block.start) + visible.slice(block.end);
        singleRegex.lastIndex = block.start; continue;
      }
    }
    singleRegex.lastIndex = block.end;
  }

  // 3. Check for in-flight / partial / incomplete tool calls at the end of visible
  const candidateRegex = /(?:\[\s*)?\{\s*"/g;
  let candMatch;
  while ((candMatch = candidateRegex.exec(visible)) !== null) {
    if (isLiteral(visible, candMatch.index)) continue;
    const block = extractBalancedBlock(visible, candMatch.index);
    if (!block) {
      // This is an unclosed candidate tool call!
      let cutStart = candMatch.index;
      const prefix = visible.slice(0, cutStart);
      const prefixMatch = prefix.match(/(?:\{\s*"?\w+"?\s*|```(?:json)?\s*|<tool_call\s*>\s*)$/i);
      if (prefixMatch && !isLiteral(visible, prefix.length - prefixMatch[0].length)) {
        cutStart -= prefixMatch[0].length;
      }
      const control = signature(visible.slice(cutStart));
      if (streaming || control) visible = visible.slice(0, cutStart);
      if (!streaming && control) { incomplete = true; hasProtocol = true; }
      break;
    }
    candidateRegex.lastIndex = block.end;
  }

  // Also check if visible ends with an opening fragment: e.g. `[ {` or `{ "tool` or `{"` or `{`
  if (streaming) {
    const trailingFragment = visible.match(/(?:\[\s*)?\{\s*(?:"[a-zA-Z0-9_.-]*)?(?:\{\s*(?:"[a-zA-Z0-9_.-]*)?)?$/i)
      || visible.match(/(?:\[\s*)?\{\s*"(?:action|name|tool|function|type)"?[^}]*$/i)
      || visible.match(/\[\s*\{?\s*$/);
    if (trailingFragment && !isLiteral(visible, trailingFragment.index)) {
      visible = visible.slice(0, trailingFragment.index);
    }
  }

  return { text: visible, calls, hasProtocol, incomplete, invalid };
}

function extractFencedProtocol(text, options) {
  let visible = ''; let cursor = 0;
  const calls = []; let hasProtocol = false; let incomplete = false; let invalid = false;
  const fences = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)\n/gm;
  for (let opening; (opening = fences.exec(text));) {
    const marker = opening[1][0]; const size = opening[1].length;
    const closePattern = new RegExp(`^[ \\t]{0,3}${marker === '`' ? '`' : '~'}{${size},}[ \\t]*(?:\\n|$)`, 'gm');
    closePattern.lastIndex = fences.lastIndex;
    const close = closePattern.exec(text);
    const end = close ? closePattern.lastIndex : text.length;
    if (options.preserveExamples || !/^(?:json|tool[_-]?calls?|function[_-]?calls?|text|plaintext)?\s*$/i.test(opening[2])) { fences.lastIndex = end; continue; }
    visible += text.slice(cursor, opening.index);
    const body = text.slice(fences.lastIndex, close ? close.index : end);
    const result = extractJsonCalls(body, { ...options, streaming: !close });
    if (result.hasProtocol || result.incomplete) {
      hasProtocol = true; calls.push(...result.calls); incomplete ||= !close || result.incomplete;
      invalid ||= result.invalid;
      // Remove the transport wrapper as well as the call itself.
      if (close) visible += result.text.trim() ? result.text : '';
    } else if (!close && options.streaming) {
      // Buffer ambiguous JSON fences so partial control JSON never flashes.
    } else visible += text.slice(opening.index, end);
    cursor = end; fences.lastIndex = end;
  }
  visible += text.slice(cursor);
  if (options.streaming && !options.preserveExamples) {
    const fragment = visible.match(/(?:^|\n)[ \t]{0,3}(?:`+|~+)(?:j(?:s(?:o(?:n)?)?)?|tool[_-]?[a-z]*|function[_-]?[a-z]*|text|plaintext)?$/i);
    if (fragment && !isLiteral(visible, fragment.index + (fragment[0].startsWith('\n') ? 1 : 0))) visible = visible.slice(0, fragment.index);
  }
  return { text: visible, calls, hasProtocol, incomplete, invalid };
}

export function extractToolProtocol(text, { streaming = false, knownToolNames = TOOL_NAMES, preserveExamples = false } = {}) {
  const knownTools = new Set(knownToolNames);
  const fenced = extractFencedProtocol(text, { streaming, knownTools, preserveExamples });
  text = fenced.text;
  let markerProtocol = false;
  for (const marker of ['[TOOL_CALLS]', '[tool_call]', '[/tool_call]', '<|tool_call|>', '<|python_tag|>']) {
    let index = text.indexOf(marker);
    while (index >= 0) {
      if (isLiteral(text, index)) { index = text.indexOf(marker, index + marker.length); continue; }
      markerProtocol = true; text = text.slice(0, index) + text.slice(index + marker.length); index = text.indexOf(marker, index);
    }
    if (streaming) for (let size = marker.length - 1; size > 0; size--) {
      if (text.endsWith(marker.slice(0, size)) && !isLiteral(text, text.length - size)) { text = text.slice(0, -size); break; }
    }
  }
  let visible = '';
  let cursor = 0;
  let hasProtocol = fenced.hasProtocol || markerProtocol;
  let incomplete = fenced.incomplete;
  let invalid = fenced.invalid;
  const calls = [...fenced.calls];
  const openings = /<tool_call\s*>/gi;
  for (let opening; (opening = openings.exec(text));) {
    if (isLiteral(text, opening.index)) continue;
    hasProtocol = true;
    visible += text.slice(cursor, opening.index);
    const bodyStart = openings.lastIndex;
    const closing = /<\/tool_call\s*>/gi;
    closing.lastIndex = bodyStart;
    const end = closing.exec(text);
    if (!end) { incomplete = true; cursor = text.length; break; }
    const call = parseCall(text.slice(bodyStart, end.index));
    if (call) calls.push(call);
    else invalid = true;
    cursor = closing.lastIndex;
    openings.lastIndex = cursor;
  }
  visible += text.slice(cursor);
  // Hold partial opening tags across SSE boundaries; never flash control text.
  if (!incomplete) {
    const start = visible.lastIndexOf('<');
    const tail = visible.slice(start).toLowerCase();
    if (start >= 0 && '<tool_call>'.startsWith(tail) && !isLiteral(visible, start) && (streaming || tail.length >= 6)) {
      visible = visible.slice(0, start);
      if (!streaming) { incomplete = true; hasProtocol = true; }
    }
  }

  const jsonResult = extractJsonCalls(visible, { streaming, knownTools });
  if (jsonResult.hasProtocol) {
    hasProtocol = true;
    calls.push(...jsonResult.calls);
  }
  if (jsonResult.incomplete) {
    incomplete = true;
  }
  invalid ||= jsonResult.invalid;
  visible = jsonResult.text;
  if (markerProtocol && !calls.length) {
    // A reserved transport marker must never turn an unknown call into prose.
    visible = '';
    if (!streaming) invalid = true;
  }

  return { text: visible, calls, hasProtocol, incomplete, invalid };
}
