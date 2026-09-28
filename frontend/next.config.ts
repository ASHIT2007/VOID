import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import path from "path";

export default function nextConfig(phase: string): NextConfig {
  return {
    poweredByHeader: false,
    experimental: { proxyClientMaxBodySize: '26mb' },
    async headers() {
      return [{ source: '/sandbox-runtime/:path*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }, { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }] }, { source: '/:path*', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      ] }];
    },
    // A validation build must never overwrite the live development server's
    // route manifest. Sharing `.next` made every `/api/*` route return the
    // framework 404 page until the dev process was restarted.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next-build",
    serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
    outputFileTracingIncludes: {
      '/api/preview-runtime/*': ['../node_modules/three/build/*.js', '../node_modules/three/examples/jsm/**/*.js'],
    },
    turbopack: {
      root: path.resolve(__dirname, ".."),
    },
  };
}
