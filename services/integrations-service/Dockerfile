# Build context: repo root (see docker-compose.yml).
FROM node:22-alpine
WORKDIR /app

COPY services/integrations-service/package.json ./package.json
RUN npm install --omit=dev

COPY packages ./packages
COPY services/integrations-service/src ./src
COPY services/integrations-service/providers ./providers

ENV NODE_ENV=production
EXPOSE 4005

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://localhost:4005/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
