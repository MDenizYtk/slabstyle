# SLAB STYLE Car Care — üretim imajı
#
# Hedefler (target):
#   web     : Next.js (standalone) — mağaza + admin + webhook'lar
#   worker  : BullMQ worker — senkronizasyon, sipariş iletimi, zamanlayıcı
#   migrate : migration + ilk kurulum (scripts/bootstrap.ts), sonra çıkar
#
# Taban imaj Playwright'ın resmi imajıdır: B2B bayi paneli adapter'ı Chromium ister
# (hem worker'daki senkronizasyonlar hem admin'deki bağlantı testi için).
# Sürüm package.json'daki playwright sürümüyle aynı olmalıdır.

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

FROM base AS deps
# Derleme sırasında gerçek veritabanı gerekmez; Prisma config'i için yer tutucu.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci && npm cache clean --force

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=pwuser:pwuser /app/.next/standalone ./
COPY --from=build --chown=pwuser:pwuser /app/.next/static ./.next/static
COPY --from=build --chown=pwuser:pwuser /app/public ./public
RUN mkdir -p /app/storage/uploads /app/storage/debug && chown -R pwuser:pwuser /app/storage
USER pwuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

FROM deps AS worker
COPY . .
RUN npx prisma generate && mkdir -p /app/storage/uploads /app/storage/debug && chown -R pwuser:pwuser /app/storage
ENV NODE_ENV=production
USER pwuser
CMD ["npx", "tsx", "scripts/worker.ts"]

FROM deps AS migrate
COPY . .
RUN npx prisma generate
ENV NODE_ENV=production
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx scripts/bootstrap.ts"]
