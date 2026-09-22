import { notFound } from 'next/navigation';
import PreviewCheck from './preview-check';

export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <PreviewCheck />;
}
