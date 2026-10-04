# Build context: repo root (see docker-compose.yml).
FROM node:22-alpine
WORKDIR /app

COPY services/admin-service/package.json ./package.json
RUN npm install --omit=dev

COPY packages ./packages
COPY services/admin-service/src ./src

ENV NODE_ENV=production
EXPOSE 4009

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://localhost:4009/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
