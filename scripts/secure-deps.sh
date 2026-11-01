#!/usr/bin/env sh
set -eu

expected_node_version="$(cat .nvmrc)"
node_version="$(node -p 'process.versions.node')"
if [ "$node_version" != "$expected_node_version" ]; then
  echo "Expected Node.js $expected_node_version (see .nvmrc); found $node_version" >&2
  exit 1
fi
npm_version="$(npm --version)"
if ! node -e 'const [a,b,c] = process.argv[1].split(".").map(Number); if (a !== 11 || [a,b,c].some(Number.isNaN) || b < 19 || (b === 19 && c < 1)) process.exit(1)' "$npm_version"; then
  echo "Expected npm 11.19.1 or newer within npm 11; found $npm_version" >&2
  exit 1
fi

# Refuse floating transitive dependencies. Generate/review/commit this file
# on a trusted machine with registry access before running a release check.
if [ ! -s package-lock.json ]; then
  echo "Missing package-lock.json. Run 'npm run lock:refresh', review it, and commit it first." >&2
  exit 1
fi

npm run deps:check
npm ci --no-fund
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
npm run prisma:generate
npm run prisma:validate
npm run typecheck
npm run test
npm run build
