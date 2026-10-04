# sharp requires glibc, not musl/Alpine (same constraint as the main
# Dockerfile — see its own comment) — bookworm-slim, not alpine, here.
FROM node:22-bookworm-slim
WORKDIR /app

COPY services/media-service/package.json ./package.json
RUN npm install --omit=dev

COPY packages ./packages
COPY services/media-service/src ./src

RUN mkdir -p /data/media && chmod 700 /data/media

ENV NODE_ENV=production
EXPOSE 4004

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://localhost:4004/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
