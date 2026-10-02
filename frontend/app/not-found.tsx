import type { Metadata } from 'next';
import ErrorScreen from '@/components/ErrorScreen';

export const metadata: Metadata = { title: 'Page not found · VOID' };

export default function NotFound() {
  return <ErrorScreen kind="not-found" />;
}
