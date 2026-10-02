const fallbackMessage = 'An unexpected error prevented this page from loading.';

/** Next error boundaries can receive any thrown value, including non-Error objects. */
export function errorInformation(error: unknown): { message: string; reference?: string } {
  const value = error && typeof error === 'object' ? error as { message?: unknown; digest?: unknown } : null;
  const original = typeof error === 'string' ? error : typeof value?.message === 'string' ? value.message : '';
  const reference = typeof value?.digest === 'string' && value.digest.trim() ? value.digest.trim() : undefined;
  // Production server errors deliberately omit the cause; explain that accurately and retain the log reference.
  const message = /an error occurred in the server components render/i.test(original)
    ? `The server could not finish rendering this page. The detailed cause is available in the server logs${reference ? ' using the error reference below' : ''}.`
    : original.trim() || fallbackMessage;
  return { message, reference };
}
