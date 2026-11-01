import type { Request, Response, NextFunction } from 'express';
import { allowedOrigins, isProduction } from '../config/env.js';
import { isValidCsrfToken, makeCsrfToken, safeEqual } from '../utils/crypto.js';

export const csrfCookieName = isProduction ? '__Host-rudra_csrf' : 'rudra_csrf';
export function setCsrfCookie(res: Response, token: string) {
  res.cookie(csrfCookieName, token, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
  });
}

export function issueCsrf(_req: Request, res: Response) {
  const token = makeCsrfToken();
  setCsrfCookie(res, token);
  res.json({ csrfToken: token });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  // Provider callbacks are authenticated by provider HMAC over the raw request body, not browser CSRF tokens.
  if (req.originalUrl.startsWith('/api/v1/payments/webhooks/')) return next();
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin || !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: { code: 'CSRF_ORIGIN_REJECTED', message: 'Request origin is not allowed.' } });
    return;
  }
  const cookie = req.cookies?.[csrfCookieName];
  const header = req.get('x-csrf-token');
  if (typeof cookie !== 'string' || typeof header !== 'string' || !safeEqual(cookie, header) || !isValidCsrfToken(header)) {
    res.status(403).json({ error: { code: 'CSRF_TOKEN_INVALID', message: 'A valid CSRF token is required.' } });
    return;
  }
  next();
}
