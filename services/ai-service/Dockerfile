# sharp (vision-image normalization) requires glibc, not musl/Alpine — same
# constraint as media-service/publishing-service.
FROM node:22-bookworm-slim
WORKDIR /app

COPY services/ai-service/package.json ./package.json
RUN npm install --omit=dev

COPY packages ./packages
COPY services/ai-service/src ./src

ENV NODE_ENV=production
EXPOSE 4003

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://localhost:4003/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
