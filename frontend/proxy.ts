import { NextRequest, NextResponse } from 'next/server';
import { requireDeploymentAccess } from './lib/deployment-access';
import { backendUrl } from './lib/backend';

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/health') return NextResponse.next();
  // Immutable public runtime libraries must load from an opaque sandbox origin.
  // Keep this allowlist exact: application pages, API and user files remain gated.
  if (/^\/sandbox-runtime\/(?:worker\.js|emscripten-module\.wasm|pyodide\.js|pyodide\.asm\.mjs|pyodide\.asm\.wasm|python_stdlib\.zip|pyodide-lock\.json|NOTICES\.txt)$/.test(request.nextUrl.pathname)) return NextResponse.next();
  // The backend authenticates socket upgrades using one-use, 60-second tickets.
  // Resolve at runtime so the private backend can change after the build.
  if (request.nextUrl.pathname === '/api/voice-stream') {
    return NextResponse.rewrite(new URL(backendUrl(`/api/voice-stream${request.nextUrl.search}`)));
  }
  return requireDeploymentAccess(request) || NextResponse.next();
}

export const config = { matcher: '/:path*' };
