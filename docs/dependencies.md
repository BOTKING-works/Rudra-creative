# Dependency and runtime baseline

## Policy

- All directly declared npm dependencies must use exact versions. `npm run deps:check` enforces this rule.
- A reviewed `package-lock.json` must be committed for production releases. Direct pins alone do not freeze transitive dependencies.
- Use `npm ci`, not `npm install`, for all CI and release installs. Create or refresh the lockfile only through the explicit `npm run lock:refresh` command on a trusted connected workstation.
- CI, release scripts and container builds refuse to run without a reviewed `package-lock.json`; they use `npm ci`, never an implicit lockfile refresh. They run `npm audit --audit-level=moderate` and a production-only audit. Release builds stop for known moderate, high, or critical advisories until resolved or explicitly risk-accepted with a documented owner decision.
- GitHub Actions are pinned to verified full commit SHAs; Dependabot checks npm workspaces, Docker images, and GitHub Actions weekly.
- Do not apply `npm audit fix --force` blindly. Review semver-major updates, provider SDK changes, Prisma migrations, and native modules separately.
- Retain lockfile integrity and registry provenance. Do not add untrusted registries or install packages from arbitrary git URLs.

## Selected runtime and image baseline

| Component | Version | Reason |
|---|---:|---|
| Node.js | 24.22.2 | Exact Node 24 LTS patch supported by Prisma 6; Node also bundles npm 11.19.1. |
| PostgreSQL | 16.15 | Current maintained PostgreSQL 16 minor; preserves the existing major-version behavior. |
| Caddy | 2.11.7 | Current stable 2.11 patch baseline. |

## Main npm package baseline

| Area | Exact version |
|---|---:|
| React / React DOM | 19.3.1 |
| React Router DOM | 6.30.6 (latest v6 patch line; major migration deferred) |
| Vite | 8.3.5 |
| Vite React plugin | 6.1.2 |
| Vitest | 5.0.5 |
| TypeScript | 7.0.2 |
| Express | 5.3.0 |
| Express rate limit | 8.7.1 |
| Helmet | 8.3.0 |
| Argon2 | 0.45.1 |
| Nodemailer | 10.3.1 |
| Zod | 4.6.7 |
| AWS SDK S3 client and presigner | 3.1161.0 |
| Prisma CLI and Client | 6.19.3 |

Prisma 6.19.3 is retained instead of taking the Prisma 7 major line. Prisma 7 needs a dedicated migration and integration test pass; a security refresh should not silently make that schema/client transition.

## One-time lockfile generation

On a trusted machine with npm registry access, create the lockfile once:

```sh
nvm install
node --version  # must be v24.22.2
npm --version   # must be v11.19.1 or newer within npm 11
npm run lock:refresh
npm run deps:check
npm ci
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
npm run prisma:generate
npm run prisma:validate
npm run typecheck
npm run test
npm run build
```

Review and commit `package-lock.json` after the above succeeds. Once committed, the Dockerfiles, CI, and release script use `npm ci` with the checked-in lockfile. They intentionally fail closed when it is absent; there is no no-lock bootstrap path.

## References checked during this update

- actions/checkout v7.0.1 verified release commit: https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1
- actions/setup-node v7.1.0 verified release commit: https://github.com/actions/setup-node/commit/949feb2413d6458794dcd2491c4babbbce0c15c1

- Node.js release schedule: https://github.com/nodejs/Release
- PostgreSQL 16 release notes: https://www.postgresql.org/docs/16/release.html
- Caddy signed release: https://github.com/caddyserver/caddy/releases/tag/v2.11.7
- Vite security advisories: https://github.com/vitejs/vite/security/advisories
- npm package version records: https://www.npmjs.com/package/vite, https://www.npmjs.com/package/vitest, https://www.npmjs.com/package/express, https://www.npmjs.com/package/@prisma/client

This document records selected package versions, not a clean bill of health. A real `npm audit` against the committed lockfile and image scanning are still required.
