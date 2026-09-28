import { notFound } from 'next/navigation';
import ClientToolsHost from '@/components/ClientToolsHost';
export default function WorkspacePreview() { if (process.env.NODE_ENV === 'production') notFound(); return <main className="min-h-screen bg-neutral-900"><ClientToolsHost preview /></main>; }
