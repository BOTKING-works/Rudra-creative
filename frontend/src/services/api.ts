export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
let csrfToken: string | null = null;

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; }
}

async function refreshCsrf() {
  const response = await fetch(`${API_BASE}/auth/csrf`, { credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.csrfToken) throw new ApiError('Unable to start a secure request. Please reload the page.', response.status);
  csrfToken = data.csrfToken as string;
  return csrfToken;
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!csrfToken) await refreshCsrf();
    headers.set('X-CSRF-Token', csrfToken!);
  }
  const response = await fetch(`${API_BASE}${path}`, { ...options, method, headers, credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (typeof data.csrfToken === 'string') csrfToken = data.csrfToken;
  if (!response.ok) throw new ApiError(data?.error?.message || 'Request failed. Please try again.', response.status, data?.error?.code);
  return data as T;
}

export function formatINR(paise: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
}
