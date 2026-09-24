# SocialPulse — production Dockerfile (Step 1: no DB, no auth)
# Multi-stage, Debian slim (sharp + ffmpeg-static require glibc, not musl/Alpine)
# Next.js 16.3.2 standalone output

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- Stage 1: dependencies ----
FROM base AS deps
# libc6-compat not needed on Debian; sharp needs no extra apt on bookworm-slim for runtime,
# but building from source fallback would need python/make — we use prebuilt via npm ci.
COPY package.json package-lock.json ./
RUN npm ci

# ---- Stage 2: build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# .env files are NOT copied via .dockerignore — build must succeed without secrets.
# NEXT_PUBLIC_APP_URL is baked at build time for client bundle if provided via --build-arg.
# Default to the production tunnel URL so Instagram media URLs use HTTPS.
ARG NEXT_PUBLIC_APP_URL=https://socialpulse.dotstark.tech
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
RUN npm run build

# ---- Stage 3: production runtime ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# curl for HEALTHCHECK; ca-certificates for HTTPS fetches to external APIs
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone output: server.js + minimal node_modules + .next/static + public
# Public is needed at runtime; standalone server expects it at ./public
COPY --from=builder /app/public ./public
# next.config.ts output:"standalone" produces .next/standalone/server.js and traced node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Runtime writable locations:
# - scheduled-posts.json, *-tokens.json, canva-sessions.json at /app (process.cwd())
# - .instagram-media at /app/.instagram-media (24h staging for Instagram publishes)
# - whapi/whatsapp event logs at /app/*.log
# - ffmpeg temp at OS tmpdir (/tmp/socialpulse-ffmpeg)
# Create empty placeholders so bind mounts have correct ownership and the app can
# write even when no host file is mounted yet (fresh clone).
# /app itself must be writable by nextjs for atomic rename temp files
# (post-store writes scheduled-posts.json.<uuid>.tmp then renameSync).
RUN mkdir -p /app/.instagram-media /tmp/socialpulse-ffmpeg \
  && touch /app/scheduled-posts.json /app/linkedin-tokens.json /app/facebook-tokens.json /app/canva-sessions.json /app/whatsapp-events.log /app/whapi-events.log \
  && chown -R nextjs:nodejs /app/.instagram-media /tmp/socialpulse-ffmpeg \
  && chown nextjs:nodejs /app/scheduled-posts.json /app/linkedin-tokens.json /app/facebook-tokens.json /app/canva-sessions.json /app/whatsapp-events.log /app/whapi-events.log \
  && chmod 600 /app/scheduled-posts.json /app/linkedin-tokens.json /app/facebook-tokens.json /app/canva-sessions.json || true \
  && chown nextjs:nodejs /app \
  && chmod 775 /app

USER nextjs

EXPOSE 3000

# Lightweight healthcheck: root page does not trigger AI/external APIs.
# start-period 20s covers cold start on first request.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Standalone server entrypoint
CMD ["node", "server.js"]
