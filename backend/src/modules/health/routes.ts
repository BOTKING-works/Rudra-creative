import { Router } from 'express';
import { prisma } from '../../config/db.js';

export const healthRouter = Router();
healthRouter.get('/live', (_req, res) => res.json({ status: 'ok', service: 'rudra-commerce-api' }));
healthRouter.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', checks: { database: 'ok' } });
  } catch {
    res.status(503).json({ status: 'not_ready', checks: { database: 'failed' } });
  }
});
