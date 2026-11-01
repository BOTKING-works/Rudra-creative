import { Router } from 'express';
import { randomInt, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { requireAuth, setSessionCookie, clearSessionCookie, sessionExpiry } from '../../middleware/auth.js';
import { setCsrfCookie } from '../../middleware/csrf.js';
import { makeCsrfToken, otpDigest, randomToken, safeEqual, sessionDigest, sha256 } from '../../utils/crypto.js';
import { sendEmail } from '../../services/email.js';

export const authRouter = Router();
const emailSchema = z.string().trim().email().max(254).transform((v) => v.toLowerCase());
const passwordSchema = z.string().min(12).max(128).refine((s) => !/^password123/i.test(s), 'Choose a stronger password.');
const registerSchema = z.object({ email: emailSchema, password: passwordSchema });
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
const verifySchema = z.object({ challengeId: z.string().min(8).max(100), otp: z.string().regex(/^\d{6}$/) });
const resendSchema = z.object({ email: emailSchema });
const forgotSchema = z.object({ email: emailSchema });
const resetSchema = z.object({ email: emailSchema, token: z.string().min(32).max(200), newPassword: passwordSchema });

function publicUser(user: { id: string; email: string; role: string; emailVerifiedAt: Date | null }) {
  return { id: user.id, email: user.email, role: user.role, emailVerified: Boolean(user.emailVerifiedAt) };
}

async function createEmailOtp(userId: string, email: string, purpose: 'EMAIL_VERIFY' | 'ADMIN_LOGIN' = 'EMAIL_VERIFY') {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await prisma.otpChallenge.count({ where: { userId, purpose, createdAt: { gte: since } } });
  if (recentCount >= env.OTP_MAX_PER_HOUR) throw Object.assign(new Error('Too many verification messages requested. Try again later.'), { status: 429 });
  const latest = await prisma.otpChallenge.findFirst({ where: { userId, purpose }, orderBy: { createdAt: 'desc' } });
  if (latest && Date.now() - latest.createdAt.getTime() < env.OTP_RESEND_COOLDOWN_SECONDS * 1000) {
    throw Object.assign(new Error('Please wait before requesting another verification code.'), { status: 429 });
  }
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000);
  await prisma.$transaction([
    prisma.otpChallenge.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
    prisma.otpChallenge.create({ data: { id, userId, purpose, digest: otpDigest(id, otp), expiresAt, maxAttempts: env.OTP_MAX_ATTEMPTS } }),
  ]);
  try {
    const subject = purpose === 'ADMIN_LOGIN' ? 'Rudra Creative administrator sign-in code' : 'Verify your Rudra Creative account';
    const purposeText = purpose === 'ADMIN_LOGIN' ? 'administrator sign-in' : 'email verification';
    await sendEmail(email, subject, `Your ${purposeText} code is ${otp}. It expires in ${env.OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this message.`);
  } catch {
    await prisma.otpChallenge.update({ where: { id }, data: { consumedAt: new Date() } }).catch(() => undefined);
    console.error(JSON.stringify({ level: 'error', event: 'EMAIL_OTP_DELIVERY_FAILED' }));
    throw Object.assign(new Error('Email delivery is temporarily unavailable. Please try again later.'), { status: 503, code: 'EMAIL_DELIVERY_UNAVAILABLE' });
  }
  return { challengeId: id, expiresAt };
}

async function establishSession(userId: string, res: Parameters<typeof setSessionCookie>[0]) {
  const rawSession = randomToken(32);
  const expiresAt = sessionExpiry();
  // Rotate the CSRF token after authentication; only a signed token is accepted by csrfGuard.
  const csrfToken = makeCsrfToken();
  const { createHash } = await import('node:crypto');
  await prisma.session.create({ data: { userId, tokenHash: sessionDigest(rawSession), csrfHash: createHash('sha256').update(csrfToken).digest('hex'), expiresAt } });
  setSessionCookie(res, rawSession, expiresAt);
  setCsrfCookie(res, csrfToken);
  return { csrfToken, expiresAt };
}

authRouter.post('/register', async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email and a password of at least 12 characters.' } });
    const { email, password } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing?.emailVerifiedAt) return res.status(202).json({ message: 'If this address is eligible for registration, check your inbox for instructions.' });
    if (existing) return res.status(409).json({ error: { code: 'ACCOUNT_PENDING', message: 'This account is awaiting verification. Request a new verification code.' } });
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const user = await prisma.user.create({ data: { email, passwordHash } });
    try {
      const challenge = await createEmailOtp(user.id, email);
      return res.status(201).json({ message: 'Account created. Check your email for a verification code.', challengeId: challenge.challengeId, expiresAt: challenge.expiresAt });
    } catch (error) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      return next(error);
    }
  } catch (error) { next(error); }
});

authRouter.post('/verify-email-otp', async (req, res, next) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid challenge identifier and six-digit code.' } });
    const { challengeId, otp } = parsed.data;
    const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId }, include: { user: true } });
    if (!challenge || challenge.purpose !== 'EMAIL_VERIFY' || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= challenge.maxAttempts) {
      return res.status(400).json({ error: { code: 'OTP_INVALID', message: 'The verification code is invalid or expired.' } });
    }
    if (!safeEqual(otpDigest(challenge.id, otp), challenge.digest)) {
      await prisma.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, attempts: { lt: challenge.maxAttempts } }, data: { attempts: { increment: 1 } } });
      return res.status(400).json({ error: { code: 'OTP_INVALID', message: 'The verification code is invalid or expired.' } });
    }
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: challenge.maxAttempts } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw Object.assign(new Error('The verification code is invalid or expired.'), { status: 400 });
      await tx.user.update({ where: { id: challenge.userId }, data: { emailVerifiedAt: new Date() } });
      await tx.otpChallenge.updateMany({ where: { userId: challenge.userId, purpose: 'EMAIL_VERIFY', id: { not: challenge.id }, consumedAt: null }, data: { consumedAt: new Date() } });
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: challenge.userId } });
    const session = await establishSession(user.id, res);
    return res.json({ message: 'Email verified.', user: publicUser(user), csrfToken: session.csrfToken });
  } catch (error) { next(error); }
});

authRouter.post('/resend-email-otp', async (req, res, next) => {
  try {
    const parsed = resendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email address.' } });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (user && !user.emailVerifiedAt) {
      const challenge = await createEmailOtp(user.id, user.email);
      return res.status(202).json({ message: 'A verification code has been sent.', challengeId: challenge.challengeId, expiresAt: challenge.expiresAt });
    }
    return res.status(202).json({ message: 'If this account requires verification, a message will be sent.' });
  } catch (error) { next(error); }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email and password.' } });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    const valid = user ? await argon2.verify(user.passwordHash, parsed.data.password).catch(() => false) : false;
    if (!user || !valid || !user.isActive) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
    if (!user.emailVerifiedAt) return res.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email before signing in.' } });
    if (['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      const challenge = await createEmailOtp(user.id, user.email, 'ADMIN_LOGIN');
      return res.status(202).json({ requiresAdminOtp: true, challengeId: challenge.challengeId, expiresAt: challenge.expiresAt, user: publicUser(user) });
    }
    const session = await establishSession(user.id, res);
    return res.json({ user: publicUser(user), csrfToken: session.csrfToken, expiresAt: session.expiresAt });
  } catch (error) { next(error); }
});

authRouter.post('/verify-admin-login-otp', async (req, res, next) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid challenge identifier and six-digit code.' } });
    const { challengeId, otp } = parsed.data;
    const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId }, include: { user: true } });
    if (!challenge || challenge.purpose !== 'ADMIN_LOGIN' || !['ADMIN', 'SUPER_ADMIN'].includes(challenge.user.role) || !challenge.user.isActive || !challenge.user.emailVerifiedAt || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= challenge.maxAttempts) {
      return res.status(400).json({ error: { code: 'OTP_INVALID', message: 'The administrator verification code is invalid or expired.' } });
    }
    if (!safeEqual(otpDigest(challenge.id, otp), challenge.digest)) {
      await prisma.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, attempts: { lt: challenge.maxAttempts } }, data: { attempts: { increment: 1 } } });
      return res.status(400).json({ error: { code: 'OTP_INVALID', message: 'The administrator verification code is invalid or expired.' } });
    }
    const consumed = await prisma.otpChallenge.updateMany({ where: { id: challenge.id, purpose: 'ADMIN_LOGIN', consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: challenge.maxAttempts } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) return res.status(400).json({ error: { code: 'OTP_INVALID', message: 'The administrator verification code is invalid or expired.' } });
    await prisma.otpChallenge.updateMany({ where: { userId: challenge.userId, purpose: 'ADMIN_LOGIN', id: { not: challenge.id }, consumedAt: null }, data: { consumedAt: new Date() } });
    const session = await establishSession(challenge.userId, res);
    return res.json({ user: publicUser(challenge.user), csrfToken: session.csrfToken, expiresAt: session.expiresAt });
  } catch (error) { next(error); }
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.authUser ? { id: req.authUser.id, email: req.authUser.email, role: req.authUser.role, emailVerified: Boolean(req.authUser.emailVerifiedAt) } : null });
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const raw = req.cookies?.[process.env.NODE_ENV === 'production' ? '__Host-rudra_session' : 'rudra_session'];
    if (typeof raw === 'string') await prisma.session.deleteMany({ where: { tokenHash: sessionDigest(raw) } });
    const { clearSessionCookie } = await import('../../middleware/auth.js');
    clearSessionCookie(res);
    const csrfToken = (await import('../../utils/crypto.js')).makeCsrfToken();
    setCsrfCookie(res, csrfToken);
    res.json({ message: 'Signed out.', csrfToken });
  } catch (error) { next(error); }
});

authRouter.post('/forgot-password', async (req, res, next) => {
  try {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email address.' } });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (user && user.isActive && user.emailVerifiedAt) {
      const token = randomToken(32);
      const digest = sha256(token);
      await prisma.passwordResetChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
      await prisma.passwordResetChallenge.create({ data: { userId: user.id, digest, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
      try {
        await sendEmail(user.email, 'Reset your Rudra Creative password', `Use this one-time token to reset your password: ${token}\nIt expires in 30 minutes. If you did not request this, ignore this email.`);
      } catch {
        // Keep the response indistinguishable from an unknown account to avoid enumeration.
        // Consume this challenge so an undelivered token cannot be used if it appears in logs or provider traces.
        await prisma.passwordResetChallenge.updateMany({ where: { userId: user.id, digest, consumedAt: null }, data: { consumedAt: new Date() } });
        console.error(JSON.stringify({ level: 'error', requestId: res.locals.requestId, event: 'PASSWORD_RESET_EMAIL_DELIVERY_FAILED' }));
      }
    }
    return res.status(202).json({ message: 'If the account exists, is verified, and is eligible, password-reset instructions will be sent.' });
  } catch (error) { next(error); }
});

authRouter.post('/reset-password', async (req, res, next) => {
  try {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Provide a valid email, reset token, and strong new password.' } });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    const digest = sha256(parsed.data.token);
    const challenge = user ? await prisma.passwordResetChallenge.findFirst({ where: { userId: user.id, digest, consumedAt: null, expiresAt: { gt: new Date() } } }) : null;
    if (!user || !challenge) return res.status(400).json({ error: { code: 'RESET_INVALID', message: 'The reset token is invalid or expired.' } });
    const passwordHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw Object.assign(new Error('The reset token is invalid or expired.'), { status: 400 });
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
    });
    return res.json({ message: 'Password reset successful. Sign in with your new password.' });
  } catch (error) { next(error); }
});
