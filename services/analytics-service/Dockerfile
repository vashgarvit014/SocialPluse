# Build context: repo root (see docker-compose.yml) so this can COPY the
# shared packages/ directory alongside its own source.
FROM node:22-alpine
WORKDIR /app

# Install into /app/node_modules so shared packages/*.mjs (copied below, as
# siblings under /app) resolve bare imports like "pg"/"zod" via Node's normal
# upward node_modules lookup, without needing npm workspaces.
COPY services/analytics-service/package.json ./package.json
RUN npm install --omit=dev

COPY packages ./packages
COPY services/analytics-service/src ./src

ENV NODE_ENV=production
EXPOSE 4008

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://localhost:4008/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
