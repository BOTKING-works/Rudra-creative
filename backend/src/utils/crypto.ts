import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function sessionDigest(value: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(value).digest('hex');
}
export function otpDigest(challengeId: string, otp: string): string {
  return createHmac('sha256', env.OTP_PEPPER).update(`${challengeId}:${otp}`).digest('hex');
}
export function makeCsrfToken(): string {
  const nonce = randomToken(32);
  const signature = createHmac('sha256', env.CSRF_SECRET).update(nonce).digest('base64url');
  return `${nonce}.${signature}`;
}
export function isValidCsrfToken(token: string): boolean {
  const [nonce, signature, extra] = token.split('.');
  if (!nonce || !signature || extra !== undefined) return false;
  const expected = createHmac('sha256', env.CSRF_SECRET).update(nonce).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return false; }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
