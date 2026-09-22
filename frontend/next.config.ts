import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import path from "path";

export default function nextConfig(phase: string): NextConfig {
  return {
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
