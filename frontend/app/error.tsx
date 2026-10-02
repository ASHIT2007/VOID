'use client';

import { useEffect } from 'react';
import ErrorScreen from '@/components/ErrorScreen';

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Something went wrong · VOID';
    return () => { document.title = previous; };
  }, []);
  return <ErrorScreen kind="application" error={error} onRetry={retry} />;
}
