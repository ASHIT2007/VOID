import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';

export function mountStaticClient(app: Express, clientDist: string): void {
  app.use(express.static(clientDist));
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/v1/')) {
      next();
      return;
    }

    const indexPath = path.join(clientDist, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }

    res.status(404).send(`
      <div style="font-family: system-ui, sans-serif; padding: 2rem; max-width: 600px; margin: 4rem auto; border: 1px solid #eaeaea; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <h2 style="color: #333;">FreeLLM API Server is Running</h2>
        <p style="color: #666;">The API server is online on <strong>port 3001</strong>.</p>
        <p style="color: #666;">The dashboard frontend UI build (index.html) was not found at <code>${indexPath}</code>.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 1.5rem 0;" />
        <p style="font-size: 0.9rem; color: #888;">API Endpoints available: <br/>
        * <code>GET /v1/models</code><br/>
        * <code>GET /api/ping</code>
        </p>
      </div>
    `);
  });
}
