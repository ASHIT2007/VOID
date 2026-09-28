import { notFound } from 'next/navigation';
import AuthScreen from '@/components/AuthScreen';

export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <AuthScreen />;
}
