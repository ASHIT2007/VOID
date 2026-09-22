import { describe, expect, it } from 'vitest';
import {
  hasUsableAssistantCompletion,
  parseToolCallArguments,
  salvagePartialAssistantText,
  shouldDiversifyModelAfterFailure,
} from '../../agent/agent-loop.js';
import type { ChatToolCall } from '@freellmapi/shared/types.js';

describe('agent completion validation', () => {
  it('rejects a stream containing neither text nor a usable tool call', () => {
    expect(hasUsableAssistantCompletion('   ', [])).toBe(false);
  });

  it('accepts visible answer text', () => {
    expect(hasUsableAssistantCompletion('A real answer', [])).toBe(true);
  });

  it('accepts a named tool call even when the assistant text is empty', () => {
    const calls: ChatToolCall[] = [{
      id: 'call-1',
      type: 'function',
      function: { name: 'web_search', arguments: '{"query":"Kakashi"}' },
    }];
    expect(hasUsableAssistantCompletion('', calls)).toBe(true);
  });

  it('recovers a valid tool object followed by stray streamed prose', () => {
    expect(parseToolCallArguments('{"query":"AI coding tools"}Here is the answer.')).toEqual({
      query: 'AI coding tools',
    });
  });

  it('does not turn an unparseable tool call into an object', () => {
    expect(parseToolCallArguments('{"query":')).toBeNull();
  });

  it('moves to a distinct model for empty, rate-limited, and unavailable routes', () => {
    expect(shouldDiversifyModelAfterFailure(new Error('empty completion from model'))).toBe(true);
    expect(shouldDiversifyModelAfterFailure(new Error('429 rate limit reached'))).toBe(true);
    expect(shouldDiversifyModelAfterFailure(new Error('503 service unavailable'))).toBe(true);
  });

  it('salvages a coherent sentence-complete prefix from a dropped stream', () => {
    const partial = 'The first verified finding is complete and useful for the user. The second verified finding also adds enough context to answer safely. This unfinished fragment';
    expect(salvagePartialAssistantText(partial)).toBe(
      'The first verified finding is complete and useful for the user. The second verified finding also adds enough context to answer safely.',
    );
    expect(salvagePartialAssistantText('A short fragment')).toBe('');
  });
});
