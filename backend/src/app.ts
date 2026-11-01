import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { allowedOrigins, isProduction } from './config/env.js';
import { csrfGuard, issueCsrf } from './middleware/csrf.js';
import { requestContext, notFound, errorHandler } from './utils/http.js';
import { healthRouter } from './modules/health/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { catalogRouter, adminCatalogRouter } from './modules/catalog/routes.js';
import { storageRouter, adminStorageRouter } from './modules/storage/routes.js';
import { customPrintRouter, adminCustomPrintRouter } from './modules/custom-print/routes.js';
import { contentRouter, adminContentRouter } from './modules/content/routes.js';
import { commerceRouter } from './modules/commerce/routes.js';
import { paymentsRouter } from './modules/payments/routes.js';
import { adminOrdersRouter } from './modules/admin/orders.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(requestContext);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true, preload: false } : false,
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-ID', 'Idempotency-Key'],
  maxAge: 600,
}));
app.use(cookieParser());
app.use(express.json({ limit: '1mb', strict: true, verify(req, _res, buffer) { (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use('/api/v1', csrfGuard);

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } } });
const authSensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.' } } });
const paymentVerifyLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many payment verification attempts. Try again later.' } } });
const checkoutLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many checkout attempts. Try again later.' } } });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false });

app.use('/api/v1', apiLimiter, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.get('/api/v1/health/live', (_req, res) => res.json({ status: 'ok', service: 'rudra-commerce-api' }));
app.use('/api/v1/health', healthRouter);
app.get('/api/v1/auth/csrf', issueCsrf);
app.use(['/api/v1/auth/register', '/api/v1/auth/login', '/api/v1/auth/verify-admin-login-otp', '/api/v1/auth/verify-email-otp', '/api/v1/auth/resend-email-otp', '/api/v1/auth/forgot-password', '/api/v1/auth/reset-password'], authSensitiveLimiter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1', catalogRouter);
app.use('/api/v1/payments/verify', paymentVerifyLimiter);
app.use('/api/v1/payments', paymentsRouter);
app.use('/api/v1/checkout', checkoutLimiter);
app.use('/api/v1', commerceRouter);
app.use('/api/v1/uploads', uploadLimiter, storageRouter);
app.use('/api/v1/custom-print', customPrintRouter);
app.use('/api/v1/content', contentRouter);
app.use('/api/v1/admin/orders', adminOrdersRouter);
app.use('/api/v1/admin', adminCatalogRouter);
app.use('/api/v1/admin/custom-print', adminCustomPrintRouter);
app.use('/api/v1/admin/content', adminContentRouter);
app.use('/api/v1/admin', adminStorageRouter);
app.use('/api/v1', notFound);
app.use(errorHandler);
