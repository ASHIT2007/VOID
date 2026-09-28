import { notFound } from 'next/navigation';
import DiagramPreview from '@/components/DiagramPreview';

export default function DiagramPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <DiagramPreview />;
}
