import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export function validInternalKey(value: string | undefined): boolean {
  const key = process.env.VOID_INTERNAL_KEY;
  return !!key && key.length >= 32 && timingSafeEqual(
    createHash('sha256').update(value || '').digest(), createHash('sha256').update(key).digest(),
  );
}

export function requireInternalAccess(req: Request, res: Response, next: NextFunction): void {
  if (!process.env.VOID_INTERNAL_KEY && process.env.NODE_ENV !== 'production') { next(); return; }
  if (!process.env.VOID_INTERNAL_KEY || process.env.VOID_INTERNAL_KEY.length < 32) {
    res.status(503).json({ error: { message: 'Service access is not configured' } }); return;
  }
  if (!validInternalKey(req.get('x-void-internal-key'))) {
    res.status(401).json({ error: { message: 'Authentication required' } }); return;
  }
  next();
}
