# Local development setup

## Prerequisites

- Node.js 24.22.2 and npm 11.19.1 or newer within npm 11 (use `nvm install` to read `.nvmrc`)
- Docker Engine and Docker Compose plugin (or a PostgreSQL 16-compatible database)
- A network connection for initial npm dependency installation

## Start a local development database

```bash
cp .env.example .env
```

Replace `SESSION_SECRET`, `OTP_PEPPER`, and `CSRF_SECRET` with separate random strings (at least 32 characters). The `.env.example` database password is local-only. Never reuse it on a server.

```bash
docker compose up -d postgres
npm run lock:refresh
# Review and commit package-lock.json before release
npm ci
npm run security:deps
npm run prisma:generate
npm run db:migrate
```

The current migrations were authored but have **not been validated by Prisma in this environment** because DNS access to the npm registry is unavailable and dependencies cannot be installed. Validate it against a disposable PostgreSQL database before depending on it.

Start three development processes in separate terminals:

```bash
npm run dev:api
npm run dev:storefront
npm run dev:admin
```

- Storefront: `http://localhost:5173`
- Admin: `http://localhost:5174`
- API liveness: `http://localhost:4000/api/v1/health/live`
- Database readiness: `http://localhost:4000/api/v1/health/ready`

## Email

OTP registration and password-reset email delivery require SMTP. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM`. The API never returns the OTP or reset token in its JSON response. If SMTP is not configured, email-dependent workflows fail rather than silently pretending messages were sent.

## First administrator

After migrations, configure `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`. Password must be at least 16 characters and not a placeholder. Then run:

```bash
npm --workspace backend run admin:bootstrap
```

Bootstrap creates a verified `SUPER_ADMIN` once; it does not elevate an existing account. Remove the bootstrap variables from deployment secrets after creation where your secret manager allows it.

## Optional demo data

```bash
npm run db:seed
```

This opt-in command adds two explicitly labelled demo products and a demo category, with zero inventory. They are not supplied business catalog data. Remove/replace them before production.

## Validation commands

```bash
npm run typecheck
npm run test
npm run build
```

These commands still need to be executed after dependencies install. All direct dependencies are exact-version pinned. A committed `package-lock.json` is still mandatory for a reproducible production release. The first lockfile must be generated in a trusted environment with npm registry access (`npm run lock:refresh`), reviewed, and committed. Do not use `npm audit fix --force` without reviewing breaking changes.
