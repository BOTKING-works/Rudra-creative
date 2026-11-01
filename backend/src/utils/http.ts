import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[a-zA-Z0-9._-]{1,80}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-ID', requestId);
  res.locals.requestId = requestId;
  const start = Date.now();
  res.on('finish', () => {
    const record = {
      level: res.statusCode >= 500 ? 'error' : 'info',
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    };
    console.log(JSON.stringify(record));
  });
  next();
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const err = error instanceof Error ? error : new Error('Unknown error');
  const status = (error as { status?: number })?.status;
  if (status && ((status >= 400 && status < 500) || status === 502 || status === 503)) {
    res.status(status).json({ error: { code: status >= 500 ? 'SERVICE_UNAVAILABLE' : (error as { code?: string })?.code || 'REQUEST_ERROR', message: err.message } });
    return;
  }
  console.error(JSON.stringify({ level: 'error', requestId: res.locals.requestId, message: err.message }));
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
}
