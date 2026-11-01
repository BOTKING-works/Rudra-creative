import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export class EmailNotConfiguredError extends Error {
  constructor() { super('Transactional email is not configured. Configure SMTP before using email verification.'); }
}

export async function sendEmail(to: string, subject: string, text: string) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.MAIL_FROM) throw new EmailNotConfiguredError();
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === 'true',
    requireTLS: env.NODE_ENV === 'production' && env.SMTP_SECURE !== 'true',
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  await transporter.sendMail({ from: env.MAIL_FROM, to, subject, text });
}
