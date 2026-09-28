import { requireDeploymentAccess } from '@/lib/deployment-access';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const runtimeRequire = createRequire(path.join(process.cwd(), 'package.json'));
const threeRoot = path.resolve(path.dirname(runtimeRequire.resolve('three')), '..');

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const denied = requireDeploymentAccess(_request);
  if (denied) return denied;
  const { path: segments } = await context.params;
  const file = segments.join('/');
  if (segments.some(segment => !/^[\w.-]+$/.test(segment) || segment === '..')
    || !/^(?:build\/three\.(?:module|core)(?:\.min)?\.js|examples\/jsm\/[\w./-]+\.js)$/.test(file))
    return new Response('Not found', { status: 404 });
  try {
    const bytes = await readFile(path.join(threeRoot, ...segments));
    return new Response(bytes, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } });
  } catch (error) {
    console.warn('[preview-runtime] Could not read installed Three.js module', threeRoot, file, error);
    return new Response('Not found', { status: 404 });
  }
}
