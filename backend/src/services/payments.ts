import { createHmac, randomUUID } from 'node:crypto';
import type { Order, PaymentAttempt, User } from '@prisma/client';
import { env } from '../config/env.js';
import { safeEqual } from '../utils/crypto.js';

type Provider = 'RAZORPAY' | 'CASHFREE';
type CheckoutInput = { order: Order; attempt: PaymentAttempt; user: Pick<User, 'id' | 'email'>; phone: string };
export type CheckoutSession =
  | { provider: 'RAZORPAY'; keyId: string; email: string; phone: string; providerOrderId: string; amountPaise: number; currency: 'INR'; orderId: string; orderNumber: string }
  | { provider: 'CASHFREE'; paymentSessionId: string; environment: 'sandbox' | 'production'; providerOrderId: string; orderId: string; orderNumber: string };

function unavailable(message: string): Error { return Object.assign(new Error(message), { status: 503 }); }
export function assertProviderConfigured(provider: Provider, forCheckout = false) {
  if (forCheckout && env.NODE_ENV === 'production' && !env.PAYMENTS_ENABLED) {
    throw unavailable('Payments are disabled for this production deployment. The owner must enable checkout after provider sandbox acceptance and live credential approval.');
  }
  if (provider === 'RAZORPAY' && (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)) {
    throw unavailable('Razorpay is not configured. Set its server-side key ID, key secret, and webhook secret before enabling checkout.');
  }
  if (provider === 'CASHFREE' && (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY || !env.CASHFREE_WEBHOOK_SECRET)) {
    throw unavailable('Cashfree is not configured. Set its server-side app ID, secret key, and webhook secret before enabling checkout.');
  }
}

async function jsonRequest(url: string, init: RequestInit, label: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { ...init, signal: controller.signal, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Do not return provider response text or credential-bearing headers to clients/logs.
      const err = new Error(`${label} request failed with provider HTTP status ${response.status}.`);
      Object.assign(err, { status: 502 });
      throw err;
    }
    return data;
  } catch (error) {
    if (error instanceof Error && 'status' in error) throw error;
    const err = new Error(`${label} is temporarily unavailable. No payment success has been assumed.`);
    Object.assign(err, { status: 502 });
    throw err;
  } finally { clearTimeout(timer); }
}

export async function createProviderCheckout(provider: Provider, input: CheckoutInput): Promise<{ session: CheckoutSession; providerOrderId: string; metadata: Record<string, unknown> }> {
  assertProviderConfigured(provider, true);
  if (provider === 'RAZORPAY') {
    const response = await jsonRequest('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}` },
      body: JSON.stringify({ amount: input.order.totalPaise, currency: 'INR', receipt: input.order.orderNumber, notes: { internal_order_id: input.order.id } }),
    }, 'Razorpay order creation');
    if (typeof response.id !== 'string' || response.amount !== input.order.totalPaise || response.currency !== 'INR') throw unavailable('Razorpay returned an unexpected order response; checkout was not enabled.');
    return {
      session: { provider: 'RAZORPAY', keyId: env.RAZORPAY_KEY_ID, email: input.user.email, phone: input.phone, providerOrderId: response.id, amountPaise: input.order.totalPaise, currency: 'INR', orderId: input.order.id, orderNumber: input.order.orderNumber },
      providerOrderId: response.id,
      metadata: { receipt: input.order.orderNumber },
    };
  }

  const cashfreeOrderId = input.order.orderNumber.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const baseUrl = env.CASHFREE_ENVIRONMENT === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
  const response = await jsonRequest(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'x-client-id': env.CASHFREE_APP_ID,
      'x-client-secret': env.CASHFREE_SECRET_KEY,
      'x-api-version': env.CASHFREE_API_VERSION,
      'x-request-id': randomUUID(),
      'x-idempotency-key': input.attempt.idempotencyKey,
    },
    body: JSON.stringify({
      order_id: cashfreeOrderId,
      order_amount: input.order.totalPaise / 100,
      order_currency: 'INR',
      customer_details: { customer_id: input.user.id.slice(0, 50), customer_email: input.user.email, customer_phone: input.phone },
      order_meta: { return_url: `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/payment/result?provider=cashfree&orderId=${encodeURIComponent(input.order.id)}`, notify_url: `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/api/v1/payments/webhooks/cashfree` },
      order_note: `Rudra Creative ${input.order.orderNumber}`,
    }),
  }, 'Cashfree order creation');
  if (typeof response.payment_session_id !== 'string' || response.order_id !== cashfreeOrderId) throw unavailable('Cashfree returned an unexpected order response; checkout was not enabled.');
  return {
    session: { provider: 'CASHFREE', paymentSessionId: response.payment_session_id, environment: env.CASHFREE_ENVIRONMENT, providerOrderId: cashfreeOrderId, orderId: input.order.id, orderNumber: input.order.orderNumber },
    providerOrderId: cashfreeOrderId,
    metadata: { paymentSessionId: response.payment_session_id, environment: env.CASHFREE_ENVIRONMENT },
  };
}

export function verifyRazorpayCallback(providerOrderId: string, paymentId: string, suppliedSignature: string): boolean {
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${providerOrderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, suppliedSignature.toLowerCase());
}

export function verifyRazorpayWebhook(rawBody: Buffer, signature: string): boolean {
  const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return safeEqual(expected, signature.toLowerCase());
}

export function verifyCashfreeWebhook(rawBody: Buffer, timestamp: string, signature: string): boolean {
  const expected = createHmac('sha256', env.CASHFREE_WEBHOOK_SECRET).update(timestamp).update(rawBody).digest('base64');
  return safeEqual(expected, signature);
}

export async function fetchRazorpayPayment(paymentId: string) {
  assertProviderConfigured('RAZORPAY');
  return jsonRequest(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: { Authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}` },
  }, 'Razorpay payment verification');
}

export async function fetchCashfreePayments(providerOrderId: string) {
  assertProviderConfigured('CASHFREE');
  const baseUrl = env.CASHFREE_ENVIRONMENT === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
  return jsonRequest(`${baseUrl}/orders/${encodeURIComponent(providerOrderId)}/payments`, {
    method: 'GET',
    headers: { 'x-client-id': env.CASHFREE_APP_ID, 'x-client-secret': env.CASHFREE_SECRET_KEY, 'x-api-version': env.CASHFREE_API_VERSION, 'x-request-id': randomUUID() },
  }, 'Cashfree payment verification');
}

export function providerName(value: string): Provider | null { return value === 'RAZORPAY' || value === 'CASHFREE' ? value : null; }
