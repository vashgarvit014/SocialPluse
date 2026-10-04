# No sharp/ffmpeg here — alpine is fine (unlike media-service/publishing-service).
FROM node:22-alpine
WORKDIR /app

COPY services/scheduler-service/package.json ./package.json
RUN npm install --omit=dev

COPY packages ./packages
COPY services/scheduler-service/src ./src

ENV NODE_ENV=production
EXPOSE 4007

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://localhost:4007/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
