import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';

export const catalogRouter = Router();
export const adminCatalogRouter = Router();

const productSelect = {
  id: true, name: true, slug: true, sku: true, description: true, categoryId: true, createdAt: true, updatedAt: true,
  basePricePaise: true, salePricePaise: true, currency: true, dimensionsMm: true,
  weightGrams: true, leadTimeDays: true, status: true, seoTitle: true, seoDescription: true,
  category: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, objectKey: true, altText: true, isPrimary: true, sortOrder: true } },
  variants: { where: { isActive: true }, orderBy: { name: 'asc' as const }, select: { id: true, sku: true, name: true, material: true, color: true, pricePaise: true, salePricePaise: true, stockQuantity: true, reservedQuantity: true, attributes: true } },
};

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  material: z.string().trim().max(60).optional(),
  color: z.string().trim().max(60).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  availability: z.enum(['in-stock', 'all']).default('all'),
  sort: z.enum(['relevance', 'price-asc', 'price-desc', 'newest', 'name']).default('newest'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

function publicProduct<T extends { images?: { objectKey: string; altText: string; isPrimary: boolean; sortOrder: number; id: string }[] }>(item: T) {
  // Object keys are metadata, not public URLs. Delivery URL support is added only once a public asset base is configured.
  const { images, ...rest } = item;
  const publicBase = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, '');
  return {
    ...rest,
    images: (images ?? []).map((img) => { const { objectKey, ...visible } = img; return { ...visible, url: publicBase && objectKey.startsWith('products/') ? `${publicBase}/${objectKey.split('/').map(encodeURIComponent).join('/')}` : null }; }),
  };
}

catalogRouter.get('/categories', async (_req, res, next) => {
  try {
    const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, slug: true, description: true, parentId: true } });
    res.json({ data: categories });
  } catch (error) { next(error); }
});

async function listProducts(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid catalog filters.' } });
    const q = parsed.data;
    if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'minPrice cannot exceed maxPrice.' } });

    const filters: Prisma.Sql[] = [Prisma.sql`p."status" = 'ACTIVE'`];
    const searchTerm = q.q?.trim();
    if (searchTerm) {
      const escaped = searchTerm.replace(/[\\%_]/g, '\\$&');
      const like = `%${escaped}%`;
      filters.push(Prisma.sql`(
        to_tsvector('simple', coalesce(p."name", '') || ' ' || coalesce(p."sku", '') || ' ' || coalesce(p."description", ''))
          @@ websearch_to_tsquery('simple', ${searchTerm})
        OR p."sku" ILIKE ${like}
        OR EXISTS (SELECT 1 FROM "ProductVariant" pv WHERE pv."productId" = p."id" AND pv."isActive" = TRUE AND pv."sku" ILIKE ${like})
      )`);
    }
    if (q.category) filters.push(Prisma.sql`EXISTS (SELECT 1 FROM "Category" c WHERE c."id" = p."categoryId" AND c."slug" = ${q.category} AND c."isActive" = TRUE)`);
    if (q.material || q.color || q.availability === 'in-stock') {
      filters.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."isActive" = TRUE
        ${q.material ? Prisma.sql`AND lower(v."material") = lower(${q.material})` : Prisma.empty}
        ${q.color ? Prisma.sql`AND lower(v."color") = lower(${q.color})` : Prisma.empty}
        ${q.availability === 'in-stock' ? Prisma.sql`AND v."stockQuantity" > v."reservedQuantity"` : Prisma.empty}
      )`);
    }
    if (q.minPrice !== undefined) filters.push(Prisma.sql`COALESCE(p."salePricePaise", p."basePricePaise") >= ${q.minPrice}`);
    if (q.maxPrice !== undefined) filters.push(Prisma.sql`COALESCE(p."salePricePaise", p."basePricePaise") <= ${q.maxPrice}`);

    const whereSql = Prisma.join(filters, ' AND ');
    const orderSql = q.sort === 'price-asc' ? Prisma.sql`COALESCE(p."salePricePaise", p."basePricePaise") ASC, p."createdAt" DESC`
      : q.sort === 'price-desc' ? Prisma.sql`COALESCE(p."salePricePaise", p."basePricePaise") DESC, p."createdAt" DESC`
      : q.sort === 'name' ? Prisma.sql`p."name" ASC`
      : q.sort === 'relevance' && searchTerm ? Prisma.sql`ts_rank(to_tsvector('simple', coalesce(p."name", '') || ' ' || coalesce(p."sku", '') || ' ' || coalesce(p."description", '')), websearch_to_tsquery('simple', ${searchTerm})) DESC, p."createdAt" DESC`
      : Prisma.sql`p."createdAt" DESC`;
    const [totalRows, idRows] = await Promise.all([
      prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS total FROM "Product" p WHERE ${whereSql}`),
      prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT p."id" FROM "Product" p WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`),
    ]);
    const total = Number(totalRows[0]?.total ?? 0n);
    const ids = idRows.map((row) => row.id);
    const found = ids.length ? await prisma.product.findMany({ where: { id: { in: ids } }, select: productSelect }) : [];
    const byId = new Map(found.map((item) => [item.id, item]));
    const items = ids.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    res.json({ data: items.map(publicProduct), pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } });
  } catch (error) { next(error); }
}
catalogRouter.get('/products', listProducts);
catalogRouter.get('/search', listProducts);

catalogRouter.get('/products/:slug', async (req, res, next) => {
  try {
    const product = await prisma.product.findFirst({ where: { slug: req.params.slug, status: 'ACTIVE' }, select: productSelect });
    if (!product) return res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } });
    const related = product.categoryId ? await prisma.product.findMany({ where: { status: 'ACTIVE', categoryId: product.categoryId, id: { not: product.id } }, take: 4, select: { id: true, name: true, slug: true, basePricePaise: true, salePricePaise: true, images: { take: 1, select: { objectKey: true, altText: true, isPrimary: true, sortOrder: true, id: true } } } }) : [];
    res.json({ data: publicProduct(product), related: related.map(publicProduct) });
  } catch (error) { next(error); }
});

const productBaseSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().min(2).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sku: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
  description: z.string().trim().min(1).max(20000),
  categoryId: z.string().nullable().optional(),
  basePricePaise: z.number().int().min(0).max(100_000_000),
  salePricePaise: z.number().int().min(0).max(100_000_000).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).default(3),
  weightGrams: z.number().int().positive().max(100_000_000).nullable().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
  seoTitle: z.string().max(180).nullable().optional(),
  seoDescription: z.string().max(320).nullable().optional(),
  taxCode: z.string().trim().min(1).max(50).nullable().optional(),
  taxRateBps: z.number().int().min(0).max(10000).nullable().optional(),
  taxEffectiveFrom: z.string().datetime({ offset: true }).nullable().optional(),
});
const productInput = productBaseSchema.superRefine((value, ctx) => {
  if (value.salePricePaise != null && value.salePricePaise > value.basePricePaise) ctx.addIssue({ code: 'custom', path: ['salePricePaise'], message: 'Sale price must not exceed base price.' });
  if ((value.taxCode != null && value.taxRateBps == null) || (value.taxRateBps != null && value.taxCode == null)) ctx.addIssue({ code: 'custom', path: ['taxCode'], message: 'Provide both an approved tax code and rate, or leave both blank until reviewed.' });
  if (value.taxRateBps != null && !value.taxEffectiveFrom) ctx.addIssue({ code: 'custom', path: ['taxEffectiveFrom'], message: 'Provide the effective date for the approved tax rate.' });
});

adminCatalogRouter.use(requireAuth, requireAdmin);
const adminProductSelect = { ...productSelect, taxCode: true, taxConfig: true };
adminCatalogRouter.get('/products', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const [data, total] = await prisma.$transaction([
      prisma.product.findMany({ orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit, select: adminProductSelect }),
      prisma.product.count(),
    ]);
    res.json({ data: data.map(publicProduct), pagination: { page, limit, total } });
  } catch (error) { next(error); }
});

adminCatalogRouter.post('/products', async (req, res, next) => {
  try {
    const parsed = productInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid product fields.', issues: parsed.error.issues } });
    const data = parsed.data;
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: {
        name: data.name, slug: data.slug, sku: data.sku, description: data.description,
        categoryId: data.categoryId ?? null, basePricePaise: data.basePricePaise,
        salePricePaise: data.salePricePaise ?? null, leadTimeDays: data.leadTimeDays,
        weightGrams: data.weightGrams ?? null, status: data.status,
        seoTitle: data.seoTitle ?? null, seoDescription: data.seoDescription ?? null,
        taxCode: data.taxCode ?? null, taxConfig: data.taxRateBps == null ? Prisma.DbNull : { rateBps: data.taxRateBps, effectiveFrom: data.taxEffectiveFrom ?? new Date().toISOString() },
      } });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'PRODUCT_CREATED', resource: 'Product', resourceId: created.id, requestId: res.locals.requestId, metadata: { status: created.status, sku: created.sku } } });
      return created;
    });
    res.status(201).json({ data: product });
  } catch (error) { next(error); }
});

adminCatalogRouter.patch('/products/:id', async (req, res, next) => {
  try {
    const parsed = productBaseSchema.partial().superRefine((value, ctx) => {
      if (value.salePricePaise != null && value.basePricePaise != null && value.salePricePaise > value.basePricePaise) ctx.addIssue({ code: 'custom', path: ['salePricePaise'], message: 'Sale price must not exceed base price.' });
      const hasTaxCode = Object.prototype.hasOwnProperty.call(value, 'taxCode');
      const hasTaxRate = Object.prototype.hasOwnProperty.call(value, 'taxRateBps');
      const hasTaxDate = Object.prototype.hasOwnProperty.call(value, 'taxEffectiveFrom');
      const taxTouched = hasTaxCode || hasTaxRate || hasTaxDate;
      if (taxTouched && !(hasTaxCode && hasTaxRate && ((value.taxCode != null && value.taxRateBps != null) || (value.taxCode === null && value.taxRateBps === null)))) ctx.addIssue({ code: 'custom', path: ['taxCode'], message: 'When changing tax settings, provide both tax code and tax rate, or set both to null; include an effective date for an active rate.' });
      if (value.taxRateBps != null && !value.taxEffectiveFrom) ctx.addIssue({ code: 'custom', path: ['taxEffectiveFrom'], message: 'Provide the effective date for the approved tax rate.' });
    }).safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Provide valid product fields to update.' } });
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } });
    const data = parsed.data;
    const { taxRateBps, taxEffectiveFrom, ...productFields } = data;
    const updateData: Prisma.ProductUncheckedUpdateInput = { ...productFields };
    if (taxRateBps !== undefined) updateData.taxConfig = taxRateBps == null ? Prisma.DbNull : { rateBps: taxRateBps, effectiveFrom: taxEffectiveFrom ?? new Date().toISOString() };
    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id: existing.id }, data: updateData });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'PRODUCT_UPDATED', resource: 'Product', resourceId: existing.id, requestId: res.locals.requestId, metadata: { fields: Object.keys(data) } } });
      return updated;
    });
    res.json({ data: product });
  } catch (error) { next(error); }
});


const variantInput = z.object({
  sku: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(1).max(120),
  material: z.string().trim().max(60).nullable().optional(),
  color: z.string().trim().max(60).nullable().optional(),
  pricePaise: z.number().int().min(0).max(100_000_000),
  salePricePaise: z.number().int().min(0).max(100_000_000).nullable().optional(),
  stockQuantity: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean().default(true),
}).superRefine((value, ctx) => { if (value.salePricePaise != null && value.salePricePaise > value.pricePaise) ctx.addIssue({ code: 'custom', path: ['salePricePaise'], message: 'Sale price must not exceed variant price.' }); });

adminCatalogRouter.post('/products/:id/variants', async (req, res, next) => {
  try {
    const parsed = variantInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid variant fields.', issues: parsed.error.issues } });
    const product = await prisma.product.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!product) return res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } });
    const v = parsed.data;
    const variant = await prisma.$transaction(async (tx) => {
      const created = await tx.productVariant.create({ data: { productId: product.id, sku: v.sku, name: v.name, material: v.material || null, color: v.color || null, pricePaise: v.pricePaise, salePricePaise: v.salePricePaise ?? null, stockQuantity: v.stockQuantity, isActive: v.isActive } });
      if (v.stockQuantity > 0) await tx.inventoryMovement.create({ data: { variantId: created.id, delta: v.stockQuantity, reason: 'INITIAL_STOCK', referenceType: 'PRODUCT_VARIANT', referenceId: created.id, actorUserId: req.authUser!.id } });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'PRODUCT_VARIANT_CREATED', resource: 'ProductVariant', resourceId: created.id, requestId: res.locals.requestId, metadata: { productId: product.id, sku: created.sku, initialStock: v.stockQuantity } } });
      return created;
    });
    res.status(201).json({ data: variant });
  } catch (error) { next(error); }
});

const stockAdjustmentInput = z.object({
  variantId: z.string().min(8).max(100),
  delta: z.number().int().min(-1_000_000).max(1_000_000).refine(value => value !== 0, 'Adjustment cannot be zero.'),
  reason: z.enum(['RESTOCK', 'RECOUNT', 'DAMAGED', 'RETURNED', 'MANUAL_CORRECTION']),
  note: z.string().trim().max(1000).optional(),
});
const movementQuery = z.object({ variantId: z.string().min(8).max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(20), page: z.coerce.number().int().min(1).default(1) });

adminCatalogRouter.get('/inventory/movements', async (req, res, next) => {
  try {
    const parsed = movementQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid inventory-history filters.' } });
    const where = parsed.data.variantId ? { variantId: parsed.data.variantId } : {};
    const [data, total] = await prisma.$transaction([
      prisma.inventoryMovement.findMany({ where, orderBy: { createdAt: 'desc' }, take: parsed.data.limit, skip: (parsed.data.page - 1) * parsed.data.limit, select: { id: true, variantId: true, delta: true, reason: true, referenceType: true, referenceId: true, createdAt: true, variant: { select: { sku: true, name: true, product: { select: { name: true } } } } } }),
      prisma.inventoryMovement.count({ where }),
    ]);
    res.json({ data, pagination: { page: parsed.data.page, limit: parsed.data.limit, total, pages: Math.ceil(total / parsed.data.limit) } });
  } catch (error) { next(error); }
});

adminCatalogRouter.post('/inventory/adjustments', async (req, res, next) => {
  try {
    const parsed = stockAdjustmentInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Provide a valid non-zero stock adjustment and reason.' } });
    const { variantId, delta, reason, note } = parsed.data;
    const existing = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true, sku: true, name: true, productId: true } });
    if (!existing) return res.status(404).json({ error: { code: 'VARIANT_NOT_FOUND', message: 'Variant not found.' } });
    const result = await prisma.$transaction(async tx => {
      // Atomic SQL prevents a concurrent order reservation from being undercut by a stock decrease.
      const updated = await tx.$queryRaw<Array<{ id: string; stockQuantity: number; reservedQuantity: number }>>(Prisma.sql`
        UPDATE "ProductVariant"
        SET "stockQuantity" = "stockQuantity" + ${delta}, "updatedAt" = NOW()
        WHERE "id" = ${variantId}
          AND "stockQuantity" + ${delta} >= "reservedQuantity"
          AND "stockQuantity" + ${delta} >= 0
          AND "stockQuantity" + ${delta} <= 1000000
        RETURNING "id", "stockQuantity", "reservedQuantity"
      `);
      if (updated.length !== 1) throw Object.assign(new Error('Stock was not changed: the adjustment would make stock negative, exceed the configured cap, or fall below active reservations. Refresh the variant and retry.'), { status: 409, code: 'INVENTORY_CONFLICT' });
      const movement = await tx.inventoryMovement.create({ data: { variantId, delta, reason, referenceType: 'MANUAL_ADJUSTMENT', referenceId: null, actorUserId: req.authUser!.id } });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'INVENTORY_ADJUSTED', resource: 'ProductVariant', resourceId: variantId, requestId: res.locals.requestId, metadata: { productId: existing.productId, delta, reason, note: note || null, stockQuantityAfter: updated[0].stockQuantity, reservedQuantity: updated[0].reservedQuantity } } });
      return { variant: { ...existing, stockQuantity: updated[0].stockQuantity, reservedQuantity: updated[0].reservedQuantity }, movement };
    });
    res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
