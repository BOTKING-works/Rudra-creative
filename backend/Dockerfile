# Build the API and Prisma client using a pinned, supported Node.js LTS image.
FROM node:24.22.2-alpine AS build
RUN apk add --no-cache python3 make g++ openssl
WORKDIR /app
COPY . .
RUN npm run deps:check \
 && test -s package-lock.json \
 && npm ci --no-fund \
 && npm audit --audit-level=moderate
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public npm run prisma:generate \
 && npm run build --workspace backend
RUN npm prune --omit=dev \
 && npm audit --omit=dev --audit-level=moderate

FROM node:24.22.2-alpine AS runtime
RUN apk add --no-cache libstdc++ openssl
ENV NODE_ENV=production PORT=4000 NODE_OPTIONS=--max-old-space-size=512
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package-lock.json ./package-lock.json
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/prisma ./backend/prisma
USER node
EXPOSE 4000
CMD ["node", "backend/dist/server.js"]
