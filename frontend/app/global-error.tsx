'use client';

import ErrorScreen from '@/components/ErrorScreen';

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  // This replaces the root layout: the recovery screen owns its styles and does not need the theme provider.
  return <html lang="en"><body style={{ margin: 0, background: '#1e1e1e' }}><title>Something went wrong · VOID</title><ErrorScreen kind="application" error={error} onRetry={retry} /></body></html>;
}
