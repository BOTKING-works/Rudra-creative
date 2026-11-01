import type { NavigateFunction } from 'react-router-dom';
import { api } from './api';

export type CheckoutResult = {
  order: { id: string; orderNumber: string; status: string; totalPaise: number; currency: 'INR' };
  checkout:
    | { provider: 'RAZORPAY'; keyId: string; email: string; phone: string; providerOrderId: string; amountPaise: number; currency: 'INR'; orderId: string; orderNumber: string }
    | { provider: 'CASHFREE'; paymentSessionId: string; environment: 'sandbox' | 'production'; providerOrderId: string; orderId: string; orderNumber: string };
};

type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayInstance = { open: () => void };
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;
type CashfreeInstance = { checkout: (options: { paymentSessionId: string; redirectTarget: '_self' }) => Promise<unknown> };

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
    Cashfree?: (options: { mode: 'sandbox' | 'production' }) => CashfreeInstance;
  }
}

export function loadPaymentScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const prior = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (prior?.dataset.loaded === 'true') return resolve();
    if (prior) {
      prior.addEventListener('load', () => resolve(), { once: true });
      prior.addEventListener('error', () => reject(new Error('Payment checkout script could not be loaded.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error('Payment checkout script could not be loaded.'));
    document.head.append(script);
  });
}

export async function launchPaymentCheckout(
  result: CheckoutResult,
  navigate: NavigateFunction,
  setStatus: (value: string) => void,
  setError: (value: string) => void,
  setBusy: (value: boolean) => void,
): Promise<void> {
  if (result.checkout.provider === 'RAZORPAY') {
    await loadPaymentScript('https://checkout.razorpay.com/v1/checkout.js');
    if (!window.Razorpay) throw new Error('Razorpay Checkout did not initialize. Check your browser and retry after checking your order status.');
    const instance = new window.Razorpay({
      key: result.checkout.keyId,
      amount: result.checkout.amountPaise,
      currency: 'INR',
      name: 'Rudra Creative',
      description: `Order ${result.checkout.orderNumber}`,
      order_id: result.checkout.providerOrderId,
      prefill: { email: result.checkout.email, contact: result.checkout.phone },
      notes: { orderNumber: result.checkout.orderNumber },
      theme: { color: '#b47b19' },
      handler: async (response: RazorpayResponse) => {
        setBusy(true);
        setStatus('Verifying payment with Razorpay…');
        try {
          const verified = await api<{ data: { status: string; orderNumber: string; totalPaise: number } }>('/payments/verify/razorpay', {
            method: 'POST',
            body: JSON.stringify({ orderId: result.order.id, razorpay_order_id: response.razorpay_order_id, razorpay_payment_id: response.razorpay_payment_id, razorpay_signature: response.razorpay_signature }),
          });
          setStatus(`Payment verified. Order ${verified.data.orderNumber} is confirmed.`);
          navigate(`/payment/result?orderId=${encodeURIComponent(result.order.id)}&verified=1`, { replace: true });
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Payment remains unverified. Check the order status before retrying.');
        } finally { setBusy(false); }
      },
      modal: { ondismiss: () => setStatus('Checkout was closed. Payment is not assumed successful; check the order status before starting another attempt.') },
    });
    instance.open();
    return;
  }

  await loadPaymentScript('https://sdk.cashfree.com/js/v3/cashfree.js');
  if (!window.Cashfree) throw new Error('Cashfree Checkout did not initialize. Check your browser and retry after checking your order status.');
  const cashfree = window.Cashfree({ mode: result.checkout.environment });
  await cashfree.checkout({ paymentSessionId: result.checkout.paymentSessionId, redirectTarget: '_self' });
}
