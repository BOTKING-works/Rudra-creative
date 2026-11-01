import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { calculateTaxPaise, lineTotalPaise, subtotalPaise } from '../../utils/money.js';
import { assertProviderConfigured, createProviderCheckout } from '../../services/payments.js';

export const commerceRouter = Router();
commerceRouter.use(requireAuth);

const indiaStates = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'] as const;
const addressInput = z.object({
  label: z.string().trim().max(60).optional(),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^(?:\+91[- ]?)?[6-9]\d{9}$/, 'Enter a valid Indian mobile number.'),
  line1: z.string().trim().min(3).max(200), line2: z.string().trim().max(200).optional(),
  locality: z.string().trim().min(2).max(120), city: z.string().trim().min(2).max(100),
  state: z.enum(indiaStates), pinCode: z.string().trim().regex(/^\d{6}$/, 'Enter a six-digit Indian PIN code.'),
  deliveryNotes: z.string().trim().max(500).optional(), isDefault: z.boolean().default(false),
});
const cartAddInput = z.object({ variantId: z.string().min(8).max(100), quantity: z.number().int().min(1).max(20) });
const cartUpdateInput = z.object({ quantity: z.number().int().min(1).max(20) });
const checkoutInput = z.object({ addressId: z.string().min(8).max(100), provider: z.enum(['RAZORPAY', 'CASHFREE']), customerNote: z.string().trim().max(1000).optional() });
const idempotencyPattern = /^[A-Za-z0-9._:-]{16,120}$/;
function problem(status: number, message: string, code = 'REQUEST_ERROR') { return Object.assign(new Error(message), { status, code }); }
function safeAddress(a: { id: string; label: string | null; fullName: string; phone: string; line1: string; line2: string | null; locality: string; city: string; state: string; pinCode: string; deliveryNotes: string | null; isDefault: boolean }) {
  // Return an explicit DTO: don't accidentally serialize Prisma-only fields such as userId.
  return { id: a.id, label: a.label, fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2, locality: a.locality, city: a.city, state: a.state, pinCode: a.pinCode, deliveryNotes: a.deliveryNotes, isDefault: a.isDefault };
}
function userId(req: import('express').Request) { if (!req.authUser) throw problem(401, 'Authentication is required.'); return req.authUser.id; }

async function customerCart(uid: string) {
  return prisma.cart.upsert({
    where: { userId: uid }, create: { userId: uid }, update: {},
    include: {
      items: { include: {
        variant: { include: {
          product: { include: {
            images: { where: { isPrimary: true }, take: 1, select: { id: true, altText: true, objectKey: true } },
          } },
        } },
      } },
    },
  });
}
function viewCart(cart: Awaited<ReturnType<typeof customerCart>>) {
  const publicBase = env.R2_PUBLIC_BASE_URL.replace(/\/$/, '');
  const items = cart.items.map((item) => {
    const v = item.variant; const p = v.product; const unitPricePaise = v.salePricePaise ?? v.pricePaise;
    const image = p.images[0];
    return { id: item.id, variantId: v.id, quantity: item.quantity, availableQuantity: Math.max(0, v.stockQuantity - v.reservedQuantity), unitPricePaise, lineTotalPaise: lineTotalPaise({ unitPricePaise, quantity: item.quantity }), product: { id: p.id, name: p.name, slug: p.slug, status: p.status, imageUrl: publicBase && image?.objectKey.startsWith('products/') ? `${publicBase}/${image.objectKey.split('/').map(encodeURIComponent).join('/')}` : null }, variant: { name: v.name, sku: v.sku, material: v.material, color: v.color } };
  });
  return { id: cart.id, items, subtotalPaise: subtotalPaise(items.map(i => ({ unitPricePaise: i.unitPricePaise, quantity: i.quantity }))) };
}

commerceRouter.get('/cart', async (req, res, next) => { try { res.json({ data: viewCart(await customerCart(userId(req))) }); } catch (e) { next(e); } });
commerceRouter.post('/cart/items', async (req, res, next) => {
  try {
    const parsed = cartAddInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Choose a valid variant and quantity (1–20).' } });
    const uid = userId(req); const variant = await prisma.productVariant.findFirst({ where: { id: parsed.data.variantId, isActive: true, product: { status: 'ACTIVE' } } });
    if (!variant) return res.status(404).json({ error: { code: 'VARIANT_UNAVAILABLE', message: 'This option is not available.' } });
    const cart = await customerCart(uid); const existing = await prisma.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } } });
    const nextQuantity = (existing?.quantity ?? 0) + parsed.data.quantity;
    if (nextQuantity > 20 || variant.stockQuantity - variant.reservedQuantity < nextQuantity) return res.status(409).json({ error: { code: 'INSUFFICIENT_STOCK', message: 'That quantity is not currently available.' } });
    await prisma.cartItem.upsert({ where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } }, create: { cartId: cart.id, variantId: variant.id, quantity: parsed.data.quantity }, update: { quantity: nextQuantity } });
    res.status(201).json({ data: viewCart(await customerCart(uid)) });
  } catch (e) { next(e); }
});
commerceRouter.patch('/cart/items/:id', async (req, res, next) => {
  try {
    const parsed = cartUpdateInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Quantity must be between 1 and 20.' } });
    const uid = userId(req); const cart = await customerCart(uid);
    const item = await prisma.cartItem.findFirst({ where: { id: req.params.id, cartId: cart.id }, include: { variant: true } });
    if (!item) return res.status(404).json({ error: { code: 'CART_ITEM_NOT_FOUND', message: 'Cart item not found.' } });
    if (item.variant.stockQuantity - item.variant.reservedQuantity < parsed.data.quantity) return res.status(409).json({ error: { code: 'INSUFFICIENT_STOCK', message: 'That quantity is not currently available.' } });
    await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: parsed.data.quantity } });
    res.json({ data: viewCart(await customerCart(uid)) });
  } catch (e) { next(e); }
});
commerceRouter.delete('/cart/items/:id', async (req, res, next) => {
  try { const cart = await customerCart(userId(req)); await prisma.cartItem.deleteMany({ where: { id: req.params.id, cartId: cart.id } }); res.json({ data: viewCart(await customerCart(userId(req))) }); }
  catch (e) { next(e); }
});

commerceRouter.get('/addresses', async (req, res, next) => { try { const data = await prisma.address.findMany({ where: { userId: userId(req) }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] }); res.json({ data: data.map(safeAddress) }); } catch (e) { next(e); } });
commerceRouter.post('/addresses', async (req, res, next) => {
  try {
    const parsed = addressInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message || 'Enter a valid Indian delivery address.' } });
    const uid = userId(req); const data = await prisma.$transaction(async tx => {
      if (parsed.data.isDefault) await tx.address.updateMany({ where: { userId: uid }, data: { isDefault: false } });
      return tx.address.create({ data: { ...parsed.data, userId: uid, line2: parsed.data.line2 || null, deliveryNotes: parsed.data.deliveryNotes || null, label: parsed.data.label || null } });
    }); res.status(201).json({ data: safeAddress(data) });
  } catch (e) { next(e); }
});
commerceRouter.delete('/addresses/:id', async (req, res, next) => {
  try { const removed = await prisma.address.deleteMany({ where: { id: req.params.id, userId: userId(req) } }); if (!removed.count) return res.status(404).json({ error: { code: 'ADDRESS_NOT_FOUND', message: 'Address not found.' } }); res.status(204).end(); }
  catch (e) { next(e); }
});

function readTaxConfig(value: Prisma.JsonValue | null, now = new Date()): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem(409, 'Tax configuration is missing for a product. An administrator must configure its approved tax code and rate before checkout.', 'TAX_NOT_CONFIGURED');
  const config = value as Record<string, Prisma.JsonValue>;
  if (typeof config.rateBps !== 'number' || !Number.isInteger(config.rateBps) || config.rateBps < 0 || config.rateBps > 10000) throw problem(409, 'A product tax rate is invalid. Checkout is blocked until it is reviewed.', 'TAX_NOT_CONFIGURED');
  if (typeof config.effectiveFrom !== 'string' || !Number.isFinite(Date.parse(config.effectiveFrom))) throw problem(409, 'A product tax effective date is missing or invalid.', 'TAX_NOT_CONFIGURED');
  if (new Date(config.effectiveFrom) > now) throw problem(409, 'A product tax rate is not yet effective.', 'TAX_NOT_EFFECTIVE');
  return config.rateBps;
}
function quoteNumber() { return `RC-${Date.now().toString(36).toUpperCase()}-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`; }

commerceRouter.post('/checkout', async (req, res, next) => {
  const uid = userId(req);
  try {
    const parsed = checkoutInput.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Choose a delivery address and payment provider.' } });
    const key = req.get('Idempotency-Key'); if (!key || !idempotencyPattern.test(key)) return res.status(400).json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Provide an Idempotency-Key with 16–120 safe characters.' } });
    assertProviderConfigured(parsed.data.provider);
    const address = await prisma.address.findFirst({ where: { id: parsed.data.addressId, userId: uid } });
    if (!address) return res.status(400).json({ error: { code: 'ADDRESS_REQUIRED', message: 'Choose a saved address belonging to your account.' } });
    const cart = await customerCart(uid);
    if (!cart.items.length) return res.status(400).json({ error: { code: 'CART_EMPTY', message: 'Add a product to your cart before checkout.' } });
    const requestHash = createHash('sha256').update(JSON.stringify({ addressId: address.id, provider: parsed.data.provider, customerNote: parsed.data.customerNote ?? '' })).digest('hex');
    const idemScope = `checkout:${uid}`;
    const prior = await prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope: idemScope, key } } });
    if (prior) {
      if (prior.requestHash !== requestHash) return res.status(409).json({ error: { code: 'IDEMPOTENCY_CONFLICT', message: 'This idempotency key was already used for a different checkout request.' } });
      if (prior.response && prior.statusCode) return res.status(prior.statusCode).json(prior.response);
      return res.status(409).json({ error: { code: 'CHECKOUT_IN_PROGRESS', message: 'This checkout is still being initialized. Check the order status before retrying.' } });
    }

    const taxMode = env.DEFAULT_TAX_MODE;
    const priced = cart.items.map((item) => {
      const v = item.variant; const p = v.product;
      if (p.status !== 'ACTIVE' || !v.isActive) throw problem(409, `“${p.name}” is no longer available. Refresh your cart.`, 'PRODUCT_UNAVAILABLE');
      const price = v.salePricePaise ?? v.pricePaise;
      if (!p.taxCode) throw problem(409, `Tax classification is missing for “${p.name}”. Checkout is blocked until the administrator configures it.`, 'TAX_NOT_CONFIGURED');
      const rateBps = readTaxConfig(p.taxConfig);
      const base = lineTotalPaise({ unitPricePaise: price, quantity: item.quantity });
      const tax = calculateTaxPaise(base, rateBps, taxMode === 'INCLUSIVE');
      return { item, product: p, variant: v, unitPricePaise: price, base, taxPaise: tax.taxPaise, lineTotalPaise: tax.totalPaise, rateBps };
    });
    const subtotal = subtotalPaise(priced.map(p => ({ unitPricePaise: p.unitPricePaise, quantity: p.item.quantity })));
    let shippingBase = env.DEFAULT_SHIPPING_FLAT_RATE_PAISE;
    if (env.FREE_SHIPPING_THRESHOLD_PAISE !== undefined && subtotal >= env.FREE_SHIPPING_THRESHOLD_PAISE) shippingBase = 0;
    let shippingTaxPaise = 0; let shippingTotal = shippingBase;
    if (shippingBase > 0) {
      if (env.SHIPPING_TAX_RATE_BPS === undefined || !env.SHIPPING_TAX_CODE || !env.SHIPPING_TAX_EFFECTIVE_FROM) throw problem(409, 'Shipping tax code, approved rate, and effective date are not configured. Checkout is blocked until the shipping tax treatment is confirmed.', 'TAX_NOT_CONFIGURED');
      if (new Date(env.SHIPPING_TAX_EFFECTIVE_FROM) > new Date()) throw problem(409, 'The configured shipping tax rate is not yet effective.', 'TAX_NOT_EFFECTIVE');
      const shipTax = calculateTaxPaise(shippingBase, env.SHIPPING_TAX_RATE_BPS, taxMode === 'INCLUSIVE'); shippingTaxPaise = shipTax.taxPaise; shippingTotal = shipTax.totalPaise;
    }
    const productTax = priced.reduce((sum, p) => sum + p.taxPaise, 0);
    const taxTotal = productTax + shippingTaxPaise;
    const totalPaise = priced.reduce((sum, p) => sum + p.lineTotalPaise, 0) + shippingTotal;
    if (!Number.isSafeInteger(totalPaise) || totalPaise < 100) throw problem(400, 'The final checkout total must be at least ₹1.00 and use valid integer paise.', 'INVALID_TOTAL');

    const shipSnapshot = { fullName: address.fullName, phone: address.phone, line1: address.line1, line2: address.line2, locality: address.locality, city: address.city, state: address.state, pinCode: address.pinCode, deliveryNotes: address.deliveryNotes, country: 'IN' };
    let created: { orderId: string; attemptId: string };
    try {
      created = await prisma.$transaction(async tx => {
        await tx.idempotencyRecord.create({ data: { scope: idemScope, key, requestHash, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
        // Recheck and reserve each variant with a conditional write to stop overselling under concurrent checkout.
        for (const p of priced) {
          const held = await tx.productVariant.updateMany({ where: { id: p.variant.id, isActive: true, stockQuantity: { gte: p.variant.reservedQuantity + p.item.quantity }, reservedQuantity: p.variant.reservedQuantity }, data: { reservedQuantity: { increment: p.item.quantity } } });
          if (held.count !== 1) throw problem(409, `Stock changed for “${p.product.name}”. Refresh the cart and try again.`, 'INSUFFICIENT_STOCK');
        }
        const order = await tx.order.create({ data: {
          orderNumber: quoteNumber(), userId: uid, status: 'PENDING_PAYMENT', currency: 'INR', subtotalPaise: subtotal,
          shippingPaise: shippingBase, discountPaise: 0, taxPaise: taxTotal, totalPaise, taxMode,
          taxBreakdown: { products: priced.map(p => ({ productId: p.product.id, taxCode: p.product.taxCode, rateBps: p.rateBps, taxableAmountPaise: p.base, taxPaise: p.taxPaise })), shipping: { taxCode: env.SHIPPING_TAX_CODE || null, rateBps: env.SHIPPING_TAX_RATE_BPS ?? null, effectiveFrom: env.SHIPPING_TAX_EFFECTIVE_FROM ?? null, taxableAmountPaise: shippingBase, taxPaise: shippingTaxPaise }, mode: taxMode },
          shippingAddressSnapshot: shipSnapshot, customerNote: parsed.data.customerNote || null,
          items: { create: priced.map(p => ({ productId: p.product.id, variantId: p.variant.id, productNameSnapshot: p.product.name, skuSnapshot: p.variant.sku, variantSnapshot: { name: p.variant.name, material: p.variant.material, color: p.variant.color }, unitPricePaise: p.unitPricePaise, quantity: p.item.quantity, taxPaise: p.taxPaise, lineTotalPaise: p.lineTotalPaise })) },
        } });
        const attempt = await tx.paymentAttempt.create({ data: { orderId: order.id, provider: parsed.data.provider, status: 'CREATED', amountPaise: totalPaise, currency: 'INR', idempotencyKey: randomUUID() } });
        return { orderId: order.id, attemptId: attempt.id };
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') return res.status(409).json({ error: { code: 'IDEMPOTENCY_CONFLICT', message: 'This checkout request was received already. Reuse the same key and inspect the result.' } });
      throw error;
    }
    const [order, attempt, user] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: created.orderId } }),
      prisma.paymentAttempt.findUniqueOrThrow({ where: { id: created.attemptId } }),
      prisma.user.findUniqueOrThrow({ where: { id: uid }, select: { id: true, email: true } }),
    ]);
    let result: Awaited<ReturnType<typeof createProviderCheckout>>;
    try {
      result = await createProviderCheckout(parsed.data.provider, { order, attempt, user, phone: address.phone.replace(/^\+91[- ]?/, '') });
    } catch (error) {
      // A timeout or lost response does not prove that a provider-side order was not created.
      // Preserve the reservation and make the attempt explicitly reconciliation-required.
      const message = error instanceof Error ? error.message : 'Payment provider initialization returned an uncertain result.';
      await prisma.$transaction(async tx => {
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'PENDING', failureCode: 'PROVIDER_INIT_UNCERTAIN', failureMessage: message.slice(0, 180) } });
        await tx.order.updateMany({ where: { id: order.id, status: 'PENDING_PAYMENT' }, data: { status: 'PAYMENT_PROCESSING' } });
      }).catch(() => undefined);
      return res.status((error as { status?: number })?.status || 502).json({ error: { code: 'PAYMENT_STATE_UNCERTAIN', message: 'The payment provider did not return a verifiable checkout result. This order is on hold and reserved stock has not been released. Do not start a second checkout; contact support with the order reference for reconciliation.' } });
    }

    const payload = { order: { id: order.id, orderNumber: order.orderNumber, status: 'PAYMENT_PROCESSING', totalPaise: order.totalPaise, currency: 'INR' }, checkout: result.session };
    try {
      await prisma.$transaction([
        prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { providerOrderId: result.providerOrderId, status: 'PENDING', providerMetadata: result.metadata as Prisma.InputJsonValue, failureCode: null, failureMessage: null } }),
        prisma.order.update({ where: { id: order.id }, data: { status: 'PAYMENT_PROCESSING' } }),
        prisma.idempotencyRecord.update({ where: { scope_key: { scope: idemScope, key } }, data: { response: payload as Prisma.InputJsonValue, statusCode: 201 } }),
      ]);
    } catch {
      // The external provider order exists. Best-effort persist its identifiers, but never release stock
      // or label the order failed merely because our final database write failed.
      await prisma.$transaction(async tx => {
        await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: { in: ['CREATED', 'PENDING'] } }, data: { providerOrderId: result.providerOrderId, status: 'PENDING', providerMetadata: result.metadata as Prisma.InputJsonValue, failureCode: 'CHECKOUT_RESULT_PERSIST_FAILED', failureMessage: 'Provider order was created, but persisting the checkout response failed. Reconciliation is required.' } });
        await tx.order.updateMany({ where: { id: order.id, status: { in: ['PENDING_PAYMENT', 'PAYMENT_PROCESSING'] } }, data: { status: 'PAYMENT_PROCESSING' } });
      }).catch(() => undefined);
      return res.status(503).json({ error: { code: 'CHECKOUT_RESULT_PERSIST_FAILED', message: 'The provider created a checkout order, but the application could not safely save the checkout response. Do not retry payment. Contact support with the order reference for reconciliation.' } });
    }
    return res.status(201).json(payload);
  } catch (e) { next(e); }
});

commerceRouter.get('/orders', async (req, res, next) => {
  try { const data = await prisma.order.findMany({ where: { userId: userId(req) }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, orderNumber: true, status: true, currency: true, totalPaise: true, createdAt: true, paidAt: true, items: { select: { productNameSnapshot: true, skuSnapshot: true, quantity: true, lineTotalPaise: true } }, shipments: { select: { carrier: true, trackingNumber: true, trackingUrl: true, status: true, shippedAt: true, deliveredAt: true } } } }); res.json({ data }); } catch (e) { next(e); }
});
commerceRouter.get('/orders/:id', async (req, res, next) => {
  try { const order = await prisma.order.findFirst({ where: { id: req.params.id, userId: userId(req) }, select: { id: true, orderNumber: true, status: true, currency: true, subtotalPaise: true, shippingPaise: true, discountPaise: true, taxPaise: true, totalPaise: true, taxMode: true, taxBreakdown: true, shippingAddressSnapshot: true, createdAt: true, paidAt: true, items: true, shipments: true, payments: { select: { provider: true, status: true, amountPaise: true, createdAt: true, verifiedAt: true } } } }); if (!order) return res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } }); res.json({ data: order }); } catch (e) { next(e); }
});
