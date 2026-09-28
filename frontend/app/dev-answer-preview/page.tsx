import { notFound } from 'next/navigation';
import AnswerFormattingPreview from '@/components/AnswerFormattingPreview';

export default function AnswerPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <AnswerFormattingPreview />;
}
