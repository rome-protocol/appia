# syntax=docker/dockerfile:1
# Appia — lean, chain-agnostic image. Active chain resolves at BUILD time from
# the committed chain-config.generated.json (refresh via `npm run
# build:chain-config`); runtime env (ROME_RPC_URL, SOLANA_RPC_URL,
# APPIA_SPONSOR_EVM_KEY_FILE, APPIA_FEE_*) is injected by the deployer — no
# secrets baked in. Mirrors the cardo/aerarium deploy shape.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
# HOSTNAME=0.0.0.0: Next.js standalone binds process.env.HOSTNAME; without this
# it binds the container name only, leaving loopback unbound (healthcheck fails).
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
