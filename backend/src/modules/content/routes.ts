import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';

export const contentRouter = Router();
export const adminContentRouter = Router();
const pageSchema = z.object({ slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), title: z.string().trim().min(2).max(180), body: z.string().max(50000), status: z.enum(['DRAFT','PUBLISHED','ARCHIVED']).default('DRAFT'), changeNote: z.string().trim().max(500).optional() });

contentRouter.get('/:slug', async (req, res, next) => {
  try {
    const page = await prisma.contentPage.findFirst({ where: { slug: req.params.slug, status: 'PUBLISHED', publishedAt: { not: null } }, select: { slug: true, title: true, body: true, publishedAt: true, updatedAt: true } });
    if (!page) return res.status(404).json({ error: { code: 'CONTENT_NOT_FOUND', message: 'This page has not been published.' } });
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({ data: page });
  } catch (error) { next(error); }
});

adminContentRouter.use(requireAuth, requireAdmin);
adminContentRouter.get('/', async (_req, res, next) => {
  try { const pages = await prisma.contentPage.findMany({ orderBy: [{ status: 'asc' }, { slug: 'asc' }], select: { id: true, slug: true, title: true, status: true, isRequired: true, publishedAt: true, updatedAt: true } }); res.json({ data: pages }); }
  catch (error) { next(error); }
});
adminContentRouter.get('/:slug', async (req, res, next) => {
  try { const page = await prisma.contentPage.findUnique({ where: { slug: req.params.slug }, include: { revisions: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, title: true, status: true, changeNote: true, createdAt: true, editor: { select: { email: true } } } } } }); if (!page) return res.status(404).json({ error: { code: 'CONTENT_NOT_FOUND', message: 'Content page not found.' } }); res.json({ data: page }); }
  catch (error) { next(error); }
});
adminContentRouter.put('/:slug', async (req, res, next) => {
  try {
    const parsed = pageSchema.safeParse({ ...req.body, slug: req.params.slug });
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid content fields.', issues: parsed.error.issues } });
    const data = parsed.data;
    if (data.status === 'PUBLISHED' && (!data.body.trim() || /\[(?:PLACEHOLDER|TODO)(?:[^\]]*)\]|\{\{[^}]+\}\}|REPLACE WITH (?:YOUR|BUSINESS|APPROVED)/i.test(data.body))) return res.status(409).json({ error: { code: 'PLACEHOLDER_PUBLICATION_BLOCKED', message: 'Replace placeholder markers with owner-approved content before publishing.' } });
    const existing = await prisma.contentPage.findUnique({ where: { slug: data.slug } });
    const page = await prisma.$transaction(async (tx) => {
      const nextPage = existing ? await tx.contentPage.update({ where: { id: existing.id }, data: { title: data.title, body: data.body, status: data.status, publishedAt: data.status === 'PUBLISHED' ? existing.publishedAt ?? new Date() : null } })
        : await tx.contentPage.create({ data: { slug: data.slug, title: data.title, body: data.body, status: data.status, isRequired: ['terms','privacy-policy','shipping-policy','returns-policy','cancellation-policy','custom-print-terms'].includes(data.slug), publishedAt: data.status === 'PUBLISHED' ? new Date() : null } });
      await tx.contentRevision.create({ data: { pageId: nextPage.id, editorId: req.authUser!.id, title: nextPage.title, body: nextPage.body, status: nextPage.status, changeNote: data.changeNote } });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'CONTENT_PAGE_SAVED', resource: 'ContentPage', resourceId: nextPage.id, requestId: res.locals.requestId, metadata: { slug: nextPage.slug, status: nextPage.status } } });
      return nextPage;
    });
    res.json({ data: page });
  } catch (error) { next(error); }
});
