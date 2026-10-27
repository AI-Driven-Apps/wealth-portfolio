# syntax=docker/dockerfile:1.7
# Multi-arch (arm64 for the Pi, amd64 elsewhere). One image runs the web app,
# the worker (different command) and migrations.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_BASE_PATH=""
# .git is not in the build context; pass the commit for the sidebar build stamp.
ARG GIT_SHA=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH NEXT_TELEMETRY_DISABLED=1 DEPLOY_TARGET=pi GIT_SHA=$GIT_SHA
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx next build \
 && npx esbuild worker/index.ts scripts/migrate.ts scripts/seed-sample.ts scripts/run-job.ts \
      --bundle --platform=node --target=node22 --format=esm --outdir=dist --out-extension:.js=.mjs \
      --external:@node-rs/argon2 --external:node-cron --alias:@=./src --conditions=react-server \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

FROM node:22-alpine AS run
WORKDIR /app
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DEPLOY_TARGET=pi TZ=Asia/Kolkata
RUN apk add --no-cache libc6-compat tzdata && addgroup -S app -g 1001 && adduser -S app -u 1001 -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/node_modules/@node-rs ./node_modules/@node-rs
# Not bundled: node-cron v4 locates its daemon.js via __dirname at load time, which
# doesn't exist inside an ESM bundle. It has no dependencies of its own.
COPY --from=build --chown=app:app /app/node_modules/node-cron ./node_modules/node-cron
USER app
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s CMD wget -qO- "http://127.0.0.1:3000${NEXT_PUBLIC_BASE_PATH}/api/health" >/dev/null || exit 1
CMD ["sh", "-c", "node dist/scripts/migrate.mjs && exec node server.js"]
