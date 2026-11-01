import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db.js';
import { env, isProduction } from '../config/env.js';
import { sessionDigest } from '../utils/crypto.js';

export const sessionCookieName = isProduction ? '__Host-rudra_session' : 'rudra_session';
export type AuthUser = { id: string; email: string; role: 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN'; emailVerifiedAt: Date | null; isActive: boolean };
declare global {
  namespace Express {
    interface Request { authUser?: AuthUser; sessionId?: string }
  }
}

export function setSessionCookie(res: Response, rawToken: string, expiresAt: Date) {
  res.cookie(sessionCookieName, rawToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(sessionCookieName, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = req.cookies?.[sessionCookieName];
    if (typeof raw !== 'string' || raw.length < 32) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
      return;
    }
    const session = await prisma.session.findUnique({
      where: { tokenHash: sessionDigest(raw) },
      include: { user: { select: { id: true, email: true, role: true, emailVerifiedAt: true, isActive: true } } },
    });
    if (!session || session.expiresAt <= new Date() || !session.user.isActive) {
      if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      clearSessionCookie(res);
      res.status(401).json({ error: { code: 'SESSION_EXPIRED', message: 'Please sign in again.' } });
      return;
    }
    req.authUser = session.user;
    req.sessionId = session.id;
    void prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    next();
  } catch (error) { next(error); }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser || !['ADMIN', 'SUPER_ADMIN'].includes(req.authUser.role)) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrative permission is required.' } });
    return;
  }
  next();
}

export function sessionExpiry() {
  return new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
}
