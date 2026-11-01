import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.js';
import { fetchCashfreePayments, fetchRazorpayPayment, verifyCashfreeWebhook, verifyRazorpayCallback, verifyRazorpayWebhook } from '../../services/payments.js';

export const paymentsRouter = Router();
function problem(status: number, message: string, code = 'PAYMENT_VERIFICATION_FAILED') { return Object.assign(new Error(message), { status, code }); }
const razorpayVerifyInput = z.object({ orderId: z.string().min(8).max(100), razorpay_order_id: z.string().min(5).max(100), razorpay_payment_id: z.string().min(5).max(100), razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i) });
const cashfreeVerifyInput = z.object({ orderId: z.string().min(8).max(100) });

async function markPaid(attemptId: string, paymentId: string) {
  return prisma.$transaction(async tx => {
    const attempt = await tx.paymentAttempt.findUnique({ where: { id: attemptId }, include: { order: { include: { items: true } } } });
    if (!attempt) throw problem(404, 'Payment attempt not found.');
    const order = attempt.order;
    if (attempt.status === 'CAPTURED' && order.status === 'PAID') return { orderId: order.id, orderNumber: order.orderNumber, status: order.status, totalPaise: order.totalPaise };
    if (attempt.amountPaise !== order.totalPaise || attempt.currency !== 'INR' || order.currency !== 'INR') throw problem(409, 'Stored order and payment amounts do not match; manual reconciliation is required.');
    if (!['PENDING_PAYMENT', 'PAYMENT_PROCESSING'].includes(order.status)) throw problem(409, 'The order is not in a payable state. Payment requires manual reconciliation.');
    for (const item of order.items) {
      if (!item.variantId) {
        const snapshot = item.variantSnapshot;
        const isCustomPrintLine = snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot) && (snapshot as Record<string, unknown>).kind === 'CUSTOM_PRINT';
        if (isCustomPrintLine) continue; // Custom-quote orders are made to order and do not reserve a catalogue SKU.
        throw problem(409, 'An order variant is missing. Payment requires manual inventory reconciliation.');
      }
      const update = await tx.productVariant.updateMany({ where: { id: item.variantId, stockQuantity: { gte: item.quantity }, reservedQuantity: { gte: item.quantity } }, data: { stockQuantity: { decrement: item.quantity }, reservedQuantity: { decrement: item.quantity } } });
      if (update.count !== 1) throw problem(409, 'Reserved inventory no longer matches this order. Payment requires manual reconciliation.');
      await tx.inventoryMovement.create({ data: { variantId: item.variantId, delta: -item.quantity, reason: 'ORDER_PAID', referenceType: 'ORDER', referenceId: order.id, actorUserId: order.userId } });
    }
    const moved = await tx.order.updateMany({ where: { id: order.id, status: { in: ['PENDING_PAYMENT', 'PAYMENT_PROCESSING'] } }, data: { status: 'PAID', paidAt: new Date() } });
    if (moved.count !== 1) throw problem(409, 'Order state changed during payment verification. Manual reconciliation is required.');
    await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'CAPTURED', providerPaymentId: paymentId, verifiedAt: new Date(), failureCode: null, failureMessage: null } });
    const cart = await tx.cart.findUnique({ where: { userId: order.userId }, select: { id: true } });
    if (cart) for (const item of order.items) {
      if (!item.variantId) continue;
      const ci = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId: item.variantId } } });
      if (!ci) continue;
      if (ci.quantity <= item.quantity) await tx.cartItem.delete({ where: { id: ci.id } });
      else await tx.cartItem.update({ where: { id: ci.id }, data: { quantity: { decrement: item.quantity } } });
    }
    return { orderId: order.id, orderNumber: order.orderNumber, status: 'PAID', totalPaise: order.totalPaise };
  });
}

async function markFailed(attemptId: string, paymentId: string | null, reason: string) {
  return prisma.$transaction(async tx => {
    const attempt = await tx.paymentAttempt.findUnique({ where: { id: attemptId }, include: { order: { include: { items: true } } } });
    if (!attempt) return;
    if (attempt.status === 'CAPTURED' || attempt.order.status === 'PAID') return; // A late failure event must never overwrite a verified capture.
    const transitioned = await tx.order.updateMany({ where: { id: attempt.orderId, status: { in: ['PENDING_PAYMENT', 'PAYMENT_PROCESSING'] } }, data: { status: 'PAYMENT_FAILED' } });
    await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', providerPaymentId: paymentId || attempt.providerPaymentId, failureCode: 'PROVIDER_PAYMENT_FAILED', failureMessage: reason.slice(0, 180) } });
    if (transitioned.count === 1) for (const item of attempt.order.items) {
      if (item.variantId) await tx.productVariant.updateMany({ where: { id: item.variantId, reservedQuantity: { gte: item.quantity } }, data: { reservedQuantity: { decrement: item.quantity } } });
    }
  });
}

paymentsRouter.post('/verify/razorpay', requireAuth, async (req, res, next) => {
  try {
    const parsed = razorpayVerifyInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid Razorpay verification details.' } });
    const order = await prisma.order.findFirst({ where: { id: parsed.data.orderId, userId: req.authUser!.id }, include: { payments: { where: { provider: 'RAZORPAY' }, orderBy: { createdAt: 'desc' }, take: 1 } } });
    const attempt = order?.payments[0];
    if (!order || !attempt || attempt.providerOrderId !== parsed.data.razorpay_order_id) return res.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment attempt not found for this account.' } });
    if (!verifyRazorpayCallback(parsed.data.razorpay_order_id, parsed.data.razorpay_payment_id, parsed.data.razorpay_signature)) return res.status(400).json({ error: { code: 'PAYMENT_SIGNATURE_INVALID', message: 'Payment signature verification failed.' } });
    const payment = await fetchRazorpayPayment(parsed.data.razorpay_payment_id);
    if (payment.order_id !== attempt.providerOrderId || payment.amount !== order.totalPaise || payment.currency !== 'INR' || payment.status !== 'captured') return res.status(409).json({ error: { code: 'PAYMENT_NOT_CAPTURED', message: 'The provider has not confirmed a captured payment matching this order. The order remains unpaid.' } });
    const result = await markPaid(attempt.id, payment.id);
    res.json({ data: result, verified: true });
  } catch (e) { next(e); }
});

paymentsRouter.post('/verify/cashfree', requireAuth, async (req, res, next) => {
  try {
    const parsed = cashfreeVerifyInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid Cashfree verification details.' } });
    const order = await prisma.order.findFirst({ where: { id: parsed.data.orderId, userId: req.authUser!.id }, include: { payments: { where: { provider: 'CASHFREE' }, orderBy: { createdAt: 'desc' }, take: 1 } } });
    const attempt = order?.payments[0];
    if (!order || !attempt?.providerOrderId) return res.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment attempt not found for this account.' } });
    const response = await fetchCashfreePayments(attempt.providerOrderId);
    const payments = Array.isArray(response) ? response : Array.isArray(response.data) ? response.data : [];
    const payment = payments.find((p: any) => p?.payment_status === 'SUCCESS' && p?.order_id === attempt.providerOrderId && Math.round(Number(p?.payment_amount) * 100) === order.totalPaise && p?.payment_currency === 'INR');
    if (!payment || !payment.cf_payment_id) return res.status(409).json({ error: { code: 'PAYMENT_NOT_SUCCESSFUL', message: 'Cashfree has not confirmed a successful payment matching this order. The order remains unpaid.' } });
    const result = await markPaid(attempt.id, String(payment.cf_payment_id));
    res.json({ data: result, verified: true });
  } catch (e) { next(e); }
});

async function handleWebhook(provider: 'RAZORPAY' | 'CASHFREE', req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  let storedEventId: string | undefined;
  try {
    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
    if (!rawBody || rawBody.length > 1024 * 1024) return res.status(400).json({ error: { code: 'WEBHOOK_BODY_INVALID', message: 'Webhook body is missing or too large.' } });
    let eventId = ''; let eventType = ''; let payload: any;
    if (provider === 'RAZORPAY') {
      const signature = req.get('x-razorpay-signature') || '';
      if (!signature || !verifyRazorpayWebhook(rawBody, signature)) return res.status(401).json({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid webhook signature.' } });
      payload = JSON.parse(rawBody.toString('utf8')); eventType = typeof payload.event === 'string' ? payload.event : 'unknown';
      eventId = req.get('x-razorpay-event-id') || createHash('sha256').update(rawBody).digest('hex');
    } else {
      const timestamp = req.get('x-webhook-timestamp') || ''; const signature = req.get('x-webhook-signature') || '';
      if (!timestamp || !signature || !verifyCashfreeWebhook(rawBody, timestamp, signature)) return res.status(401).json({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid webhook signature.' } });
      payload = JSON.parse(rawBody.toString('utf8')); eventType = typeof payload.type === 'string' ? payload.type : 'unknown';
      eventId = createHash('sha256').update(rawBody).digest('hex');
    }
    if (eventId.length > 200) eventId = createHash('sha256').update(eventId).digest('hex');
    const digest = createHash('sha256').update(rawBody).digest('hex');
    let event = await prisma.paymentWebhookEvent.findUnique({ where: { provider_providerEventId: { provider, providerEventId: eventId } } });
    if (event?.processedAt) return res.json({ received: true, duplicate: true });
    if (!event) {
      try { event = await prisma.paymentWebhookEvent.create({ data: { provider, providerEventId: eventId, eventType, payloadDigest: digest, verified: true } }); }
      catch (e) { if ((e as { code?: string })?.code === 'P2002') event = await prisma.paymentWebhookEvent.findUnique({ where: { provider_providerEventId: { provider, providerEventId: eventId } } }); else throw e; }
    }
    if (!event) return res.status(500).json({ error: { code: 'WEBHOOK_PERSIST_FAILED', message: 'Could not persist webhook event.' } });
    storedEventId = event.id;
    let attemptId: string | null = null;
    if (provider === 'RAZORPAY') {
      const entity = payload?.payload?.payment?.entity;
      const providerOrderId = typeof entity?.order_id === 'string' ? entity.order_id : '';
      const paymentId = typeof entity?.id === 'string' ? entity.id : '';
      const relevant = ['payment.captured', 'payment.failed', 'payment.authorized'].includes(eventType);
      const attempt = providerOrderId ? await prisma.paymentAttempt.findFirst({ where: { provider, providerOrderId }, include: { order: true } }) : null;
      attemptId = attempt?.id ?? null;
      if (relevant && !attempt) throw problem(503, 'Verified payment event has no matching persisted attempt yet; provider retry is required.', 'WEBHOOK_RETRY_REQUIRED');
      if (attempt && paymentId && relevant) {
        const verified = await fetchRazorpayPayment(paymentId);
        if (verified.order_id !== attempt.providerOrderId || verified.amount !== attempt.amountPaise || verified.currency !== 'INR') throw problem(409, 'Webhook payment does not match stored order amount or currency.');
        if (verified.status === 'captured') await markPaid(attempt.id, paymentId);
        else if (verified.status === 'failed') await markFailed(attempt.id, paymentId, 'Razorpay reported a verified failed payment.');
        else if (verified.status === 'authorized') {
          await prisma.paymentAttempt.updateMany({ where: { id: attempt.id, status: { in: ['CREATED', 'PENDING', 'AUTHORIZED'] } }, data: { status: 'AUTHORIZED', providerPaymentId: paymentId } });
          // Authorization is not capture. A later payment.captured event or server verification performs fulfillment.
        } else if (eventType === 'payment.captured' || eventType === 'payment.failed') {
          throw problem(503, 'Provider payment state is not yet terminal; provider retry is required.', 'WEBHOOK_RETRY_REQUIRED');
        }
      }
    } else {
      const providerOrderId = typeof payload?.data?.order?.order_id === 'string' ? payload.data.order.order_id : '';
      const paymentId = payload?.data?.payment?.cf_payment_id != null ? String(payload.data.payment.cf_payment_id) : '';
      const relevant = typeof eventType === 'string' && eventType.startsWith('PAYMENT_');
      const attempt = providerOrderId ? await prisma.paymentAttempt.findFirst({ where: { provider, providerOrderId }, include: { order: true } }) : null;
      attemptId = attempt?.id ?? null;
      if (relevant && !attempt) throw problem(503, 'Verified payment event has no matching persisted attempt yet; provider retry is required.', 'WEBHOOK_RETRY_REQUIRED');
      if (attempt && paymentId) {
        const response = await fetchCashfreePayments(providerOrderId); const list = Array.isArray(response) ? response : Array.isArray(response.data) ? response.data : [];
        const verified = list.find((p: any) => String(p?.cf_payment_id) === paymentId && p?.order_id === providerOrderId && Math.round(Number(p?.payment_amount) * 100) === attempt.amountPaise && p?.payment_currency === 'INR');
        if (verified?.payment_status === 'SUCCESS') await markPaid(attempt.id, paymentId);
        else if (verified?.payment_status === 'FAILED') await markFailed(attempt.id, paymentId, 'Cashfree reported a verified failed payment.');
        else {
          await prisma.paymentAttempt.updateMany({ where: { id: attempt.id, status: { in: ['CREATED', 'PENDING', 'AUTHORIZED'] } }, data: { status: 'PENDING', providerPaymentId: paymentId } });
          // Pending/late authorization is not paid; a later terminal event or verification decides the order.
        }
      }
    }
    await prisma.paymentWebhookEvent.update({ where: { id: event.id }, data: { paymentAttemptId: attemptId, processedAt: new Date(), processingError: null } });
    return res.json({ received: true });
  } catch (e) {
    // Leave the inbox event unprocessed so a verified retry can reconcile transient provider failures.
    if (storedEventId) await prisma.paymentWebhookEvent.update({ where: { id: storedEventId }, data: { processingError: 'Webhook provider verification or state reconciliation failed; retry or inspect the admin ledger.' } }).catch(() => undefined);
    return next(e);
  }
}
paymentsRouter.post('/webhooks/razorpay', (req, res, next) => { void handleWebhook('RAZORPAY', req, res, next); });
paymentsRouter.post('/webhooks/cashfree', (req, res, next) => { void handleWebhook('CASHFREE', req, res, next); });

paymentsRouter.get('/orders/:id', requireAuth, async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({ where: { id: req.params.id, userId: req.authUser!.id }, select: { id: true, orderNumber: true, status: true, totalPaise: true, currency: true, payments: { select: { provider: true, status: true, providerOrderId: true, amountPaise: true, createdAt: true, verifiedAt: true } } } });
    if (!order) return res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } });
    res.json({ data: order });
  } catch (e) { next(e); }
});
