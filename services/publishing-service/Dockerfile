# sharp (Instagram media staging) requires glibc, not musl/Alpine — same
# constraint as media-service/the main Dockerfile.
FROM node:22-bookworm-slim
WORKDIR /app

COPY services/publishing-service/package.json ./package.json
RUN npm install --omit=dev

COPY packages ./packages
COPY services/publishing-service/src ./src
COPY services/publishing-service/providers ./providers

ENV NODE_ENV=production
EXPOSE 4006

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://localhost:4006/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
