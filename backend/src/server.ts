import 'dotenv/config';
import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/db.js';

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', message: 'API listening', port: env.PORT, nodeEnv: env.NODE_ENV }));
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: 'info', message: 'Graceful shutdown started', signal }));
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  server.close(async (error) => {
    try { await prisma.$disconnect(); } finally {
      clearTimeout(timer);
      process.exit(error ? 1 : 0);
    }
  });
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
