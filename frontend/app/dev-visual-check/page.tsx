import { notFound } from 'next/navigation';
import VisualCheck from './visual-check';
import poster from '../../scratch/verified-poster.json';
import presentation from '../../scratch/verified-presentation.json';

export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <VisualCheck poster={poster} presentation={presentation} />;
}
