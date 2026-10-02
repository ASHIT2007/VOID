import { describe, expect, it } from 'vitest';
import { errorInformation } from '@/lib/error-screen';

describe('error screen diagnostics', () => {
  it('preserves the cause of a client error', () => {
    expect(errorInformation(new Error('The connection timed out.'))).toEqual({ message: 'The connection timed out.', reference: undefined });
  });
  it('handles strings and plain objects thrown through Next error boundaries', () => {
    expect(errorInformation('Could not load the workspace.').message).toBe('Could not load the workspace.');
    expect(errorInformation({ message: 'Request failed', digest: 'ref-123' })).toEqual({ message: 'Request failed', reference: 'ref-123' });
  });
  it('retains production server references without claiming to know the redacted cause', () => {
    const result = errorInformation({ message: 'An error occurred in the Server Components render. The specific message is omitted in production builds.', digest: '847312' });
    expect(result.reference).toBe('847312');
    expect(result.message).toContain('server logs');
    expect(result.message).not.toContain('specific message is omitted');
    expect(errorInformation({ message: 'An error occurred in the Server Components render.' }).message).not.toContain('reference below');
  });
  it('remains usable for missing or malformed thrown values', () => {
    for (const value of [undefined, null, 42, {}, { message: '   ', digest: 12 }]) {
      expect(errorInformation(value)).toEqual({ message: 'An unexpected error prevented this page from loading.', reference: undefined });
    }
  });
});
