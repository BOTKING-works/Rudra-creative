import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEPLOYMENT_STAGE: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  PUBLIC_ADMIN_URL: z.string().url().default('http://localhost:5174'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  SESSION_SECRET: z.string().min(32),
  OTP_PEPPER: z.string().min(32),
  CSRF_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(15).default(60),
  OTP_MAX_PER_HOUR: z.coerce.number().int().min(1).max(20).default(5),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  MAIL_FROM: z.string().optional().default(''),
  R2_ACCOUNT_ID: z.string().optional().default(''),
  R2_ACCESS_KEY_ID: z.string().optional().default(''),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
  R2_BUCKET_NAME: z.string().optional().default(''),
  R2_PUBLIC_BUCKET_NAME: z.string().optional().default(''),
  R2_ENDPOINT: z.string().optional().default(''),
  R2_PUBLIC_BASE_URL: z.string().optional().default(''),
  R2_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(300).default(180),
  R2_UPLOADS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(200 * 1024 * 1024).default(50 * 1024 * 1024),
  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
  CASHFREE_APP_ID: z.string().optional().default(''),
  CASHFREE_SECRET_KEY: z.string().optional().default(''),
  CASHFREE_WEBHOOK_SECRET: z.string().optional().default(''),
  CASHFREE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  PAYMENTS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CASHFREE_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2026-01-01'),
  DEFAULT_SHIPPING_FLAT_RATE_PAISE: z.coerce.number().int().min(0).max(100_000_000).default(0),
  FREE_SHIPPING_THRESHOLD_PAISE: z.preprocess((value) => value === '' || value === undefined ? undefined : value, z.coerce.number().int().min(0).max(100_000_000).optional()),
  DEFAULT_TAX_MODE: z.enum(['INCLUSIVE', 'EXCLUSIVE']).default('EXCLUSIVE'),
  SHIPPING_TAX_RATE_BPS: z.preprocess((value) => value === '' || value === undefined ? undefined : value, z.coerce.number().int().min(0).max(10000).optional()),
  SHIPPING_TAX_CODE: z.string().optional().default(''),
  SHIPPING_TAX_EFFECTIVE_FROM: z.preprocess((value) => value === '' || value === undefined ? undefined : value, z.string().datetime({ offset: true }).optional()),
  INITIAL_ADMIN_EMAIL: z.string().optional().default(''),
  INITIAL_ADMIN_PASSWORD: z.string().optional().default(''),
  BUSINESS_NAME: z.string().optional().default(''),
  BUSINESS_ADDRESS: z.string().optional().default(''),
  BUSINESS_SUPPORT_EMAIL: z.string().optional().default(''),
  BUSINESS_SUPPORT_PHONE: z.string().optional().default(''),
  BUSINESS_GSTIN: z.string().optional().default(''),
  DEFAULT_CURRENCY: z.literal('INR').default('INR'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsed.data;
export const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
export const isProduction = env.NODE_ENV === 'production';

if (isProduction && !['staging', 'production'].includes(env.DEPLOYMENT_STAGE)) {
  throw new Error('DEPLOYMENT_STAGE must be explicitly set to staging or production when NODE_ENV=production.');
}

if (isProduction) {
  for (const [name, value] of Object.entries({ SESSION_SECRET: env.SESSION_SECRET, OTP_PEPPER: env.OTP_PEPPER, CSRF_SECRET: env.CSRF_SECRET })) {
    if (value.length < 32 || /replace|change-me|example|local-only/i.test(value)) {
      throw new Error(`${name} is not suitable for production. Use a randomly generated secret.`);
    }
  }

  const appUrl = new URL(env.PUBLIC_APP_URL);
  const adminUrl = new URL(env.PUBLIC_ADMIN_URL);
  if (appUrl.protocol !== 'https:' || adminUrl.protocol !== 'https:' || appUrl.pathname !== '/' || adminUrl.pathname !== '/' || appUrl.search || adminUrl.search || appUrl.hash || adminUrl.hash) {
    throw new Error('Production PUBLIC_APP_URL and PUBLIC_ADMIN_URL must be HTTPS origins without a path, query, or fragment.');
  }
  if (appUrl.origin === adminUrl.origin) {
    throw new Error('Production storefront and admin must use separate origins.');
  }
  if (allowedOrigins.length !== 2 || !allowedOrigins.includes(appUrl.origin) || !allowedOrigins.includes(adminUrl.origin) || allowedOrigins.some((origin) => {
    try { const parsedOrigin = new URL(origin); return parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin; }
    catch { return true; }
  })) {
    throw new Error('Production CORS_ALLOWED_ORIGINS must contain exactly the HTTPS origins used by the storefront and admin.');
  }

  let databaseUrl: URL;
  try { databaseUrl = new URL(env.DATABASE_URL); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL in production.'); }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseUrl.hostname || ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname.toLowerCase())) {
    throw new Error('Production DATABASE_URL must point to the private PostgreSQL service, not localhost.');
  }
  if (!databaseUrl.username || !databaseUrl.password || /replace-with|change-me|local_only|example/i.test(`${databaseUrl.username} ${databaseUrl.password}`)) {
    throw new Error('Production DATABASE_URL must use a real least-privilege application username and a non-placeholder password.');
  }

  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.MAIL_FROM) {
    throw new Error('Production startup requires SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and MAIL_FROM.');
  }
  if (env.SMTP_PORT === 465 && env.SMTP_SECURE !== 'true') {
    throw new Error('SMTP port 465 requires SMTP_SECURE=true.');
  }
  if (env.SMTP_PORT === 587 && env.SMTP_SECURE === 'true') {
    throw new Error('SMTP port 587 must use STARTTLS (SMTP_SECURE=false), not implicit TLS.');
  }
  if (![465, 587].includes(env.SMTP_PORT)) {
    throw new Error('Production SMTP must use the authenticated submission ports 465 (implicit TLS) or 587 (STARTTLS).');
  }

  if (!/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID) || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME || !env.R2_PUBLIC_BUCKET_NAME || !env.R2_ENDPOINT || !env.R2_PUBLIC_BASE_URL) {
    throw new Error('Production requires a private and public Cloudflare R2 bucket, account ID, credentials, endpoint, and public base URL.');
  }
  if (env.R2_BUCKET_NAME === env.R2_PUBLIC_BUCKET_NAME) {
    throw new Error('The private customer-upload bucket and public product-image bucket must be different buckets.');
  }
  let r2Endpoint: URL;
  let publicAssetsUrl: URL;
  try { r2Endpoint = new URL(env.R2_ENDPOINT); publicAssetsUrl = new URL(env.R2_PUBLIC_BASE_URL); }
  catch { throw new Error('R2_ENDPOINT and R2_PUBLIC_BASE_URL must be valid URLs.'); }
  if (r2Endpoint.protocol !== 'https:' || r2Endpoint.hostname !== `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` || publicAssetsUrl.protocol !== 'https:') {
    throw new Error('Production R2 endpoint must match the configured account and both storage URLs must use HTTPS.');
  }

  const razorpayParts = [env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET];
  const cashfreeParts = [env.CASHFREE_APP_ID, env.CASHFREE_SECRET_KEY, env.CASHFREE_WEBHOOK_SECRET];
  const razorpayConfigured = razorpayParts.every(Boolean);
  const cashfreeConfigured = cashfreeParts.every(Boolean);
  if (razorpayParts.some(Boolean) && !razorpayConfigured) throw new Error('Razorpay production configuration is incomplete; set the key ID, key secret, and webhook secret together.');
  if (cashfreeParts.some(Boolean) && !cashfreeConfigured) throw new Error('Cashfree production configuration is incomplete; set the app ID, secret key, and webhook secret together.');
  if (env.PAYMENTS_ENABLED && (!razorpayConfigured || !cashfreeConfigured)) throw new Error('PAYMENTS_ENABLED=true requires complete Razorpay and Cashfree credentials and webhook secrets.');
  if (env.DEPLOYMENT_STAGE === 'staging') {
    if (razorpayConfigured && !env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) throw new Error('A staging deployment must never contain Razorpay live credentials.');
    if (cashfreeConfigured && env.CASHFREE_ENVIRONMENT !== 'sandbox') throw new Error('A staging deployment must never contain Cashfree production credentials.');
  }
  if (env.DEPLOYMENT_STAGE === 'production') {
    if (razorpayConfigured && !env.RAZORPAY_KEY_ID.startsWith('rzp_live_')) throw new Error('Production must not contain Razorpay test credentials.');
    if (cashfreeConfigured && env.CASHFREE_ENVIRONMENT !== 'production') throw new Error('Production must not contain Cashfree sandbox credentials.');
    if (env.PAYMENTS_ENABLED && (!razorpayConfigured || !cashfreeConfigured)) throw new Error('Live production payments require both complete live provider configurations.');
  }

  if (!env.BUSINESS_NAME.trim() || !env.BUSINESS_ADDRESS.trim() || !env.BUSINESS_SUPPORT_EMAIL.trim() || !env.BUSINESS_SUPPORT_PHONE.trim()) {
    throw new Error('Production requires owner-supplied BUSINESS_NAME, BUSINESS_ADDRESS, BUSINESS_SUPPORT_EMAIL, and BUSINESS_SUPPORT_PHONE.');
  }
  if (!z.string().email().safeParse(env.BUSINESS_SUPPORT_EMAIL).success || !/^(?:\+91[- ]?)?[6-9]\d{9}$/.test(env.BUSINESS_SUPPORT_PHONE.replace(/[()]/g, '').trim())) {
    throw new Error('BUSINESS_SUPPORT_EMAIL or BUSINESS_SUPPORT_PHONE is invalid.');
  }
}
