import type { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, next: NextFunction) {
  console.error('[Error]', err.message);

  if (res.headersSent) return next(err);

  const status = (err as any).code === 'LIMIT_FILE_SIZE' ? 413 : (err as any).status ?? 500;
  res.status(status).json({
    error: {
      message: status >= 500 ? 'Internal server error' : status === 413 ? 'Request is too large' : err.message,
      type: err.name ?? 'server_error',
    },
  });
}
