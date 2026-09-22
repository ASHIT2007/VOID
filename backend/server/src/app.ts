import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import './agent/index.js'; // registers all agent tools on import
import { errorHandler } from './middleware/errorHandler.js';
import { getAllowedCorsOrigins, resolveClientDist } from './config/server.js';
import { mountApiRoutes } from './http/api-routes.js';
import { mountStaticClient } from './http/static-client.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export function createApp() {
  const app = express();
  const allowedCorsOrigins = getAllowedCorsOrigins();

  // CSP intentionally disabled — the SPA bundles inline styles and the OG
  // image is loaded from the same origin; enabling helmet's default CSP
  // breaks the React build's hashed-asset loader. HSTS off because this is
  // a single-user local proxy, served over HTTP on localhost. Both should
  // stay disabled unless someone serves the proxy over HTTPS publicly
  // (which is also not a supported deployment — see README).
  app.use(helmet({ contentSecurityPolicy: false, hsts: false }));
  app.use(cors({
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      callback(null, !origin || allowedCorsOrigins.has(origin));
    },
  }));
  // 10mb: code agents (OpenCode, AionUI, Qwen Code) ship very large system
  // prompts + tool schemas + repo context; 1mb cut their sessions off
  // mid-conversation with an opaque 413. (#200)
  app.use(express.json({ limit: '10mb' }));

  mountApiRoutes(app);

  // Error handler (for API routes)
  app.use(errorHandler);

  // Serve client static files (after API error handler). CLIENT_DIST lets
  // embedders relocate the built dashboard (e.g. the desktop app ships it in
  // extraResources, where the __dirname-relative path can't reach).
  mountStaticClient(app, resolveClientDist({ dirname: __dirname }));

  return app;
}
