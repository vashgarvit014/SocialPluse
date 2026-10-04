# Build context: repo root (see docker-compose.yml). No native deps —
# plain node:22-alpine is fine.
FROM node:22-alpine
WORKDIR /app

COPY services/auth-service/package.json ./package.json
RUN npm install --omit=dev

COPY packages ./packages
COPY services/auth-service/src ./src

ENV NODE_ENV=production
EXPOSE 4011

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://localhost:4011/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
