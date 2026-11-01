import 'dotenv/config';
import argon2 from 'argon2';
import { env } from '../../config/env.js';
import { prisma } from '../../config/db.js';

async function main() {
  const email = env.INITIAL_ADMIN_EMAIL.trim().toLowerCase();
  const password = env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD before bootstrapping an administrator.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('INITIAL_ADMIN_EMAIL must be a valid email address.');
  if (password.length < 16 || /replace|change-me|password123|example/i.test(password)) throw new Error('INITIAL_ADMIN_PASSWORD must be at least 16 characters and must not be a placeholder.');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error('A user with this email already exists. Bootstrap refuses to silently elevate an existing account.');
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const user = await prisma.user.create({ data: { email, passwordHash, role: 'SUPER_ADMIN', emailVerifiedAt: new Date() } });
  console.log(JSON.stringify({ level: 'info', message: 'Administrator account created', userId: user.id, email: user.email }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Admin bootstrap failed.'); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
