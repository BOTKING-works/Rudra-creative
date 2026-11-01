FROM node:24.22.2-alpine AS build
WORKDIR /app
COPY . .
RUN npm run deps:check \
 && test -s package-lock.json \
 && npm ci --no-fund \
 && npm audit --audit-level=moderate
RUN npm run build --workspace frontend \
 && npm run build --workspace admin

FROM caddy:2.11.7-alpine AS runtime
COPY infrastructure/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv/storefront
COPY --from=build /app/admin/dist /srv/admin
