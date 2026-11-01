import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { sendEmail } from '../../services/email.js';
import { assertProviderConfigured, createProviderCheckout } from '../../services/payments.js';

export const customPrintRouter = Router();
export const adminCustomPrintRouter = Router();
const dimensionSchema = z.object({ x: z.number().positive().max(5000), y: z.number().positive().max(5000), z: z.number().positive().max(5000), unit: z.literal('mm').default('mm') }).optional();
const createSchema = z.object({
  material: z.string().trim().max(60).optional(),
  color: z.string().trim().max(60).optional(),
  quantity: z.number().int().min(1).max(1000).default(1),
  dimensionsMm: dimensionSchema,
  instructions: z.string().trim().max(5000).optional(),
  desiredBy: z.string().datetime().optional(),
  assetIds: z.array(z.string().min(8).max(100)).min(1).max(10),
});
const quoteSchema = z.object({ subtotalPaise: z.number().int().min(0).max(100_000_000), shippingPaise: z.number().int().min(0).max(10_000_000), taxPaise: z.number().int().min(0).max(100_000_000), leadTimeDays: z.number().int().min(0).max(365), terms: z.string().trim().max(5000).optional(), expiresAt: z.string().datetime() });
const quotePaySchema = z.object({ addressId: z.string().min(8).max(100), provider: z.enum(['RAZORPAY', 'CASHFREE']) });
const checkoutKeyPattern = /^[A-Za-z0-9._:-]{16,120}$/;
function customOrderNumber() { return `RC-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`; }

customPrintRouter.use(requireAuth);
customPrintRouter.post('/requests', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid custom-print request.', issues: parsed.error.issues } });
    const data = parsed.data;
    const assets = await prisma.uploadedAsset.findMany({ where: { id: { in: data.assetIds }, ownerUserId: req.authUser!.id, status: 'QUARANTINED' } });
    if (assets.length !== new Set(data.assetIds).size) return res.status(400).json({ error: { code: 'ASSET_INVALID', message: 'One or more files are unavailable, not owned by you, or not ready for review.' } });
    const modelCount = assets.filter((a) => a.purpose === 'CUSTOM_PRINT_MODEL' && ['.stl', '.3mf', '.obj'].includes(a.originalName.slice(a.originalName.lastIndexOf('.')).toLowerCase())).length;
    if (modelCount === 0) return res.status(400).json({ error: { code: 'MODEL_REQUIRED', message: 'Attach at least one quarantined 3D model file.' } });
    if (assets.some((a) => !['CUSTOM_PRINT_MODEL', 'REFERENCE_IMAGE'].includes(a.purpose))) return res.status(400).json({ error: { code: 'ASSET_PURPOSE_INVALID', message: 'Only model files and reference images can be attached.' } });
    const reference = `RC-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.customPrintRequest.create({ data: {
        reference, userId: req.authUser!.id, material: data.material, color: data.color, quantity: data.quantity,
        dimensionsMm: data.dimensionsMm, instructions: data.instructions, desiredBy: data.desiredBy ? new Date(data.desiredBy) : null,
        files: { create: assets.map((asset) => ({ assetId: asset.id, label: asset.originalName })) },
      }, include: { files: { include: { asset: { select: { id: true, originalName: true, contentType: true, sizeBytes: true, status: true } } } } } });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'CUSTOM_PRINT_REQUEST_CREATED', resource: 'CustomPrintRequest', resourceId: request.id, requestId: res.locals.requestId, metadata: { reference, fileCount: assets.length } } });
      return request;
    });
    res.status(201).json({ data: created });
  } catch (error) { next(error); }
});

customPrintRouter.get('/requests', async (req, res, next) => {
  try {
    const items = await prisma.customPrintRequest.findMany({ where: { userId: req.authUser!.id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, reference: true, status: true, material: true, color: true, quantity: true, orderId: true, createdAt: true, updatedAt: true } });
    res.json({ data: items });
  } catch (error) { next(error); }
});

customPrintRouter.get('/requests/:id', async (req, res, next) => {
  try {
    const item = await prisma.customPrintRequest.findFirst({ where: { id: req.params.id, userId: req.authUser!.id }, include: {
      files: { include: { asset: { select: { id: true, originalName: true, contentType: true, sizeBytes: true, status: true } } } },
      quotations: { where: { status: { in: ['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'] } }, orderBy: { revision: 'desc' } },
      order: { select: { id: true, orderNumber: true, status: true, totalPaise: true, currency: true } },
    } });
    if (!item) return res.status(404).json({ error: { code: 'REQUEST_NOT_FOUND', message: 'Custom-print request not found.' } });
    res.json({ data: item });
  } catch (error) { next(error); }
});

customPrintRouter.post('/requests/:id/accept-quote', async (req, res, next) => {
  try {
    const body = z.object({ quotationId: z.string().min(8).max(100) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Provide the quotation ID.' } });
    const request = await prisma.customPrintRequest.findFirst({ where: { id: req.params.id, userId: req.authUser!.id } });
    if (!request) return res.status(404).json({ error: { code: 'REQUEST_NOT_FOUND', message: 'Custom-print request not found.' } });
    const quote = await prisma.quotation.findFirst({ where: { id: body.data.quotationId, requestId: request.id } });
    if (!quote) return res.status(404).json({ error: { code: 'QUOTE_NOT_FOUND', message: 'Quotation not found for this request.' } });
    if (request.orderId && quote.status === 'ACCEPTED') {
      const order = await prisma.order.findFirst({ where: { id: request.orderId, userId: req.authUser!.id }, select: { id: true, orderNumber: true, status: true, totalPaise: true, currency: true } });
      if (order) return res.json({ data: { order }, message: 'This quotation already has a payable order.' });
    }
    if (request.orderId || quote.status !== 'SENT' || (quote.expiresAt && quote.expiresAt <= new Date())) return res.status(409).json({ error: { code: 'QUOTE_UNAVAILABLE', message: 'This quotation is expired, already processed, or no longer available.' } });
    const computedTotal = quote.subtotalPaise + quote.shippingPaise + quote.taxPaise;
    if (!Number.isSafeInteger(computedTotal) || computedTotal < 100 || computedTotal > 2_000_000_000 || computedTotal !== quote.totalPaise) return res.status(409).json({ error: { code: 'QUOTE_TOTAL_INVALID', message: 'The quotation total is inconsistent. Contact support before accepting it.' } });
    const converted = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const accepted = await tx.quotation.updateMany({ where: { id: quote.id, status: 'SENT', expiresAt: { gt: now } }, data: { status: 'ACCEPTED', acceptedAt: now } });
      if (accepted.count !== 1) throw Object.assign(new Error('This quotation is no longer available.'), { status: 409 });
      const order = await tx.order.create({ data: {
        orderNumber: customOrderNumber(), userId: request.userId, status: 'PENDING_PAYMENT', currency: 'INR',
        subtotalPaise: quote.subtotalPaise, shippingPaise: quote.shippingPaise, discountPaise: 0, taxPaise: quote.taxPaise,
        totalPaise: quote.totalPaise, taxMode: 'EXCLUSIVE',
        taxBreakdown: { source: 'CUSTOM_PRINT_QUOTE', quotationId: quote.id, taxPaise: quote.taxPaise, note: 'Amounts copied from the customer-approved quotation; not recalculated by the catalog tax engine.' },
        shippingAddressSnapshot: { pendingAddressSelection: true, country: 'IN' },
        customerNote: `Custom-print request ${request.reference}`,
        items: { create: [{ productNameSnapshot: `Custom 3D print — ${request.reference}`, skuSnapshot: `CUSTOM-${request.reference}`, variantSnapshot: { kind: 'CUSTOM_PRINT', requestReference: request.reference, requestedQuantity: request.quantity, material: request.material, color: request.color, dimensionsMm: request.dimensionsMm ?? null }, unitPricePaise: quote.subtotalPaise, quantity: 1, taxPaise: quote.taxPaise, lineTotalPaise: quote.subtotalPaise + quote.taxPaise }] },
      } });
      const moved = await tx.customPrintRequest.updateMany({ where: { id: request.id, userId: request.userId, status: 'QUOTED', orderId: null }, data: { status: 'CONVERTED_TO_ORDER', orderId: order.id } });
      if (moved.count !== 1) throw Object.assign(new Error('The request state changed while the quotation was being accepted. Refresh and try again.'), { status: 409 });
      await tx.quotation.updateMany({ where: { requestId: request.id, id: { not: quote.id }, status: 'SENT' }, data: { status: 'SUPERSEDED' } });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'CUSTOM_PRINT_QUOTE_ACCEPTED', resource: 'Quotation', resourceId: quote.id, requestId: res.locals.requestId, metadata: { orderId: order.id, totalPaise: order.totalPaise } } });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'CUSTOM_PRINT_ORDER_CREATED', resource: 'Order', resourceId: order.id, requestId: res.locals.requestId, metadata: { requestReference: request.reference, quotationId: quote.id } } });
      return { id: order.id, orderNumber: order.orderNumber, status: order.status, totalPaise: order.totalPaise, currency: order.currency };
    });
    res.json({ data: { order: converted }, message: 'Quotation accepted and converted into a payable order. Select delivery details and a payment provider to continue.' });
  } catch (error) { next(error); }
});

customPrintRouter.post('/requests/:id/pay', async (req, res, next) => {
  try {
    const parsed = quotePaySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Choose a saved Indian delivery address and payment provider.' } });
    const userId = req.authUser!.id;
    const key = req.get('Idempotency-Key');
    if (!key || !checkoutKeyPattern.test(key)) return res.status(400).json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Provide an Idempotency-Key with 16–120 safe characters.' } });
    assertProviderConfigured(parsed.data.provider);
    const request = await prisma.customPrintRequest.findFirst({ where: { id: req.params.id, userId } });
    if (!request || !request.orderId || request.status !== 'CONVERTED_TO_ORDER') return res.status(409).json({ error: { code: 'QUOTE_ORDER_NOT_READY', message: 'Accept a current quotation before starting payment.' } });
    const address = await prisma.address.findFirst({ where: { id: parsed.data.addressId, userId } });
    if (!address) return res.status(400).json({ error: { code: 'ADDRESS_REQUIRED', message: 'Choose a saved delivery address belonging to your account.' } });
    const order = await prisma.order.findFirst({ where: { id: request.orderId, userId }, include: { items: true, payments: { orderBy: { createdAt: 'desc' } } } });
    if (!order) return res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'The payable order could not be found.' } });
    if (!['PENDING_PAYMENT', 'PAYMENT_PROCESSING'].includes(order.status)) return res.status(409).json({ error: { code: order.status === 'PAID' ? 'ORDER_ALREADY_PAID' : 'ORDER_NOT_PAYABLE', message: order.status === 'PAID' ? 'This custom-print order is already paid.' : 'This custom-print order is no longer in a payable state. Contact support before attempting another payment.' } });
    const scope = `custom-quote-checkout:${userId}`;
    const requestHash = createHash('sha256').update(JSON.stringify({ requestId: request.id, orderId: order.id, addressId: address.id, provider: parsed.data.provider })).digest('hex');
    const prior = await prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    if (prior) {
      if (prior.requestHash !== requestHash) return res.status(409).json({ error: { code: 'IDEMPOTENCY_CONFLICT', message: 'This idempotency key was already used for a different payment request.' } });
      if (prior.response && prior.statusCode) return res.status(prior.statusCode).json(prior.response);
      return res.status(409).json({ error: { code: 'CHECKOUT_IN_PROGRESS', message: 'This custom-print payment is being initialized or requires reconciliation. Do not start another payment attempt.' } });
    }
    if (order.payments.length) return res.status(409).json({ error: { code: 'PAYMENT_ATTEMPT_EXISTS', message: 'A payment attempt already exists for this order. Check its status or contact support before retrying.' } });
    const snapshot = { fullName: address.fullName, phone: address.phone, line1: address.line1, line2: address.line2, locality: address.locality, city: address.city, state: address.state, pinCode: address.pinCode, deliveryNotes: address.deliveryNotes, country: 'IN' };
    let attempt;
    try {
      attempt = await prisma.$transaction(async tx => {
        await tx.idempotencyRecord.create({ data: { scope, key, requestHash, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
        await tx.order.update({ where: { id: order.id }, data: { shippingAddressSnapshot: snapshot, status: 'PAYMENT_PROCESSING' } });
        return tx.paymentAttempt.create({ data: { orderId: order.id, provider: parsed.data.provider, status: 'CREATED', amountPaise: order.totalPaise, currency: 'INR', idempotencyKey: randomUUID() } });
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return res.status(409).json({ error: { code: 'CHECKOUT_IN_PROGRESS', message: 'This payment request has already been received. Check the order status before retrying.' } });
      throw error;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true } });
    let providerResult: Awaited<ReturnType<typeof createProviderCheckout>>;
    try {
      providerResult = await createProviderCheckout(parsed.data.provider, { order, attempt, user, phone: address.phone.replace(/^\+91[- ]?/, '') });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider checkout response is uncertain.';
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'PENDING', failureCode: 'PROVIDER_INIT_UNCERTAIN', failureMessage: message.slice(0, 180) } }).catch(() => undefined);
      return res.status((error as { status?: number })?.status || 502).json({ error: { code: 'PAYMENT_STATE_UNCERTAIN', message: 'The provider did not return a verifiable checkout session. This order is on hold; do not retry payment or create a second attempt. Contact support with the order reference for reconciliation.' } });
    }
    const payload = { order: { id: order.id, orderNumber: order.orderNumber, status: 'PAYMENT_PROCESSING', totalPaise: order.totalPaise, currency: 'INR' }, checkout: providerResult.session };
    try {
      await prisma.$transaction([
        prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { providerOrderId: providerResult.providerOrderId, status: 'PENDING', providerMetadata: providerResult.metadata as Prisma.InputJsonValue, failureCode: null, failureMessage: null } }),
        prisma.idempotencyRecord.update({ where: { scope_key: { scope, key } }, data: { response: payload as Prisma.InputJsonValue, statusCode: 201 } }),
      ]);
    } catch {
      await prisma.paymentAttempt.updateMany({ where: { id: attempt.id, status: { in: ['CREATED', 'PENDING'] } }, data: { providerOrderId: providerResult.providerOrderId, status: 'PENDING', providerMetadata: providerResult.metadata as Prisma.InputJsonValue, failureCode: 'CHECKOUT_RESULT_PERSIST_FAILED', failureMessage: 'Provider order exists but the session response was not durably recorded.' } }).catch(() => undefined);
      return res.status(503).json({ error: { code: 'CHECKOUT_RESULT_PERSIST_FAILED', message: 'The provider created a payment order, but the application could not safely store the checkout response. Do not retry payment; contact support for reconciliation.' } });
    }
    res.status(201).json(payload);
  } catch (error) { next(error); }
});

customPrintRouter.post('/requests/:id/decline-quote', async (req, res, next) => {
  try {
    const body = z.object({ quotationId: z.string().min(8).max(100), reason: z.string().trim().max(1000).optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Provide a valid quotation ID.' } });
    const request = await prisma.customPrintRequest.findFirst({ where: { id: req.params.id, userId: req.authUser!.id } });
    if (!request) return res.status(404).json({ error: { code: 'REQUEST_NOT_FOUND', message: 'Custom-print request not found.' } });
    const quote = await prisma.quotation.findFirst({ where: { id: body.data.quotationId, requestId: request.id, status: 'SENT' } });
    if (!quote) return res.status(409).json({ error: { code: 'QUOTE_UNAVAILABLE', message: 'Quotation is no longer available.' } });
    await prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.updateMany({ where: { id: quote.id, requestId: request.id, status: 'SENT', expiresAt: { gt: new Date() } }, data: { status: 'DECLINED', declinedAt: new Date(), terms: body.data.reason ? `${quote.terms ?? ''}\nDeclined by customer: ${body.data.reason}`.trim() : quote.terms } });
      if (updated.count !== 1) throw Object.assign(new Error('This quotation is no longer available.'), { status: 409 });
      // Keep the request quoteable so the admin can prepare a revised quotation after a decline.
      const requestUpdated = await tx.customPrintRequest.updateMany({ where: { id: request.id, userId: req.authUser!.id, status: 'QUOTED', orderId: null }, data: { status: 'QUOTED' } });
      if (requestUpdated.count !== 1) throw Object.assign(new Error('The custom-print request has already changed state.'), { status: 409 });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'CUSTOM_PRINT_QUOTE_DECLINED', resource: 'Quotation', resourceId: quote.id, requestId: res.locals.requestId } });
    });
    res.json({ message: 'Quotation declined.' });
  } catch (error) { next(error); }
});

adminCustomPrintRouter.use(requireAuth, requireAdmin);
adminCustomPrintRouter.get('/', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const allowed = ['SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CLARIFICATION', 'QUOTED', 'ACCEPTED', 'DECLINED', 'REJECTED', 'CONVERTED_TO_ORDER', 'CANCELLED'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid status filter.' } });
    const data = await prisma.customPrintRequest.findMany({ where: status ? { status: status as never } : {}, orderBy: { createdAt: 'asc' }, take: 100, include: { user: { select: { id: true, email: true } }, files: { include: { asset: { select: { id: true, originalName: true, contentType: true, sizeBytes: true, status: true } } } }, quotations: { orderBy: { revision: 'desc' }, take: 5 } } });
    res.json({ data });
  } catch (error) { next(error); }
});

adminCustomPrintRouter.patch('/:id/status', async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum(['UNDER_REVIEW', 'NEEDS_CLARIFICATION', 'REJECTED', 'CANCELLED']), adminNotes: z.string().trim().max(5000).optional(), rejectionReason: z.string().trim().max(1000).optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid review action.' } });
    const existing = await prisma.customPrintRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: { code: 'REQUEST_NOT_FOUND', message: 'Custom-print request not found.' } });
    const allowedTransitions: Record<string, string[]> = { SUBMITTED: ['UNDER_REVIEW', 'NEEDS_CLARIFICATION', 'REJECTED', 'CANCELLED'], UNDER_REVIEW: ['NEEDS_CLARIFICATION', 'REJECTED', 'CANCELLED'], NEEDS_CLARIFICATION: ['UNDER_REVIEW', 'REJECTED', 'CANCELLED'] };
    if (!allowedTransitions[existing.status]?.includes(body.data.status)) return res.status(409).json({ error: { code: 'INVALID_STATE_TRANSITION', message: `Cannot move request from ${existing.status} to ${body.data.status}.` } });
    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.customPrintRequest.update({ where: { id: existing.id }, data: { status: body.data.status, adminNotes: body.data.adminNotes, rejectionReason: body.data.status === 'REJECTED' ? body.data.rejectionReason ?? 'Request rejected by administrator.' : undefined } });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'CUSTOM_PRINT_STATUS_CHANGED', resource: 'CustomPrintRequest', resourceId: item.id, requestId: res.locals.requestId, metadata: { from: existing.status, to: item.status } } });
      return item;
    });
    res.json({ data: updated });
  } catch (error) { next(error); }
});

adminCustomPrintRouter.post('/:id/quotations', async (req, res, next) => {
  try {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid quote details.', issues: parsed.error.issues } });
    const data = parsed.data;
    if (new Date(data.expiresAt) <= new Date()) return res.status(400).json({ error: { code: 'QUOTE_EXPIRY_INVALID', message: 'Quotation expiry must be in the future.' } });
    const request = await prisma.customPrintRequest.findUnique({ where: { id: req.params.id } });
    if (!request || !['UNDER_REVIEW', 'NEEDS_CLARIFICATION', 'SUBMITTED', 'QUOTED'].includes(request.status)) return res.status(409).json({ error: { code: 'REQUEST_NOT_QUOTABLE', message: 'This request cannot currently be quoted.' } });
    const draft = await prisma.$transaction(async (tx) => {
      // Conditional update serializes quote drafting against customer acceptance/conversion.
      // A quote may only be drafted while the request is still quoteable and has no order.
      const claimed = await tx.customPrintRequest.updateMany({
        where: { id: request.id, status: { in: ['UNDER_REVIEW', 'NEEDS_CLARIFICATION', 'SUBMITTED', 'QUOTED'] }, orderId: null },
        data: { status: 'QUOTED' },
      });
      if (claimed.count !== 1) throw Object.assign(new Error('This request was converted or changed while the quote was being prepared.'), { status: 409 });
      const latest = await tx.quotation.findFirst({ where: { requestId: request.id }, orderBy: { revision: 'desc' } });
      await tx.quotation.updateMany({ where: { requestId: request.id, status: 'SENT' }, data: { status: 'SUPERSEDED' } });
      const created = await tx.quotation.create({ data: {
        requestId: request.id, revision: (latest?.revision ?? 0) + 1, status: 'DRAFT',
        subtotalPaise: data.subtotalPaise, shippingPaise: data.shippingPaise, taxPaise: data.taxPaise,
        totalPaise: data.subtotalPaise + data.shippingPaise + data.taxPaise, currency: 'INR', leadTimeDays: data.leadTimeDays,
        terms: data.terms, expiresAt: new Date(data.expiresAt), createdByUserId: req.authUser!.id,
      } });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'CUSTOM_PRINT_QUOTATION_DRAFTED', resource: 'Quotation', resourceId: created.id, requestId: res.locals.requestId, metadata: { revision: created.revision, totalPaise: created.totalPaise } } });
      return created;
    });
    const customer = await prisma.user.findUnique({ where: { id: request.userId }, select: { email: true } });
    try {
      if (!customer) throw new Error('Customer account was not found.');
      const money = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
      await sendEmail(customer.email, `Quotation ${draft.revision} for ${request.reference}`, `A quotation is available for custom-print request ${request.reference}.
Revision: ${draft.revision}
Subtotal: ${money(draft.subtotalPaise)}
Shipping: ${money(draft.shippingPaise)}
Tax: ${money(draft.taxPaise)}
Total: ${money(draft.totalPaise)}
Lead time: ${draft.leadTimeDays} days
Expires: ${draft.expiresAt?.toISOString() ?? 'not specified'}

Sign in to review this quotation in your account.

Terms: ${draft.terms ?? 'Please review the quotation details in your account.'}`);
      const quote = await prisma.$transaction(async (tx) => {
        const sent = await tx.quotation.updateMany({ where: { id: draft.id, status: 'DRAFT' }, data: { status: 'SENT', sentAt: new Date() } });
        if (sent.count !== 1) throw Object.assign(new Error('Quotation could not be marked as sent.'), { status: 409 });
        const requestStillQuoteable = await tx.customPrintRequest.updateMany({ where: { id: request.id, status: 'QUOTED', orderId: null }, data: { status: 'QUOTED' } });
        if (requestStillQuoteable.count !== 1) throw Object.assign(new Error('The custom-print request was converted while the quote was being sent.'), { status: 409 });
        await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'CUSTOM_PRINT_QUOTATION_SENT', resource: 'Quotation', resourceId: draft.id, requestId: res.locals.requestId } });
        return tx.quotation.findUniqueOrThrow({ where: { id: draft.id } });
      });
      res.status(201).json({ data: quote, message: 'Quotation was emailed to the customer and marked sent.' });
    } catch {
      console.error(JSON.stringify({ level: 'error', event: 'CUSTOM_PRINT_QUOTE_EMAIL_OR_STATE_UPDATE_FAILED', requestId: res.locals.requestId, quotationId: draft.id }));
      res.status(201).json({ data: draft, message: 'The quotation remains a draft because delivery could not be confirmed. Check email and application health before creating a revised quotation.' });
    }
  } catch (error) { next(error); }
});
