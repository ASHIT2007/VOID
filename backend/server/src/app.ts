import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import './agent/index.js'; // registers all agent tools on import
import { errorHandler } from './middleware/errorHandler.js';
import { getAllowedCorsOrigins } from './config/server.js';
import { mountApiRoutes } from './http/api-routes.js';

export function createApp() {
  const app = express();
  const allowedCorsOrigins = getAllowedCorsOrigins();

  // Express serves JSON and attachments; HTTPS terminates at the public frontend.
  app.use(helmet({ hsts: false }));
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

  return app;
}
