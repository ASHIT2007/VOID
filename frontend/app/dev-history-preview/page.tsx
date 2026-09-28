import { notFound } from 'next/navigation';
import ChatHistoryPreview from '@/components/ChatHistoryPreview';
export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <ChatHistoryPreview />;
}
