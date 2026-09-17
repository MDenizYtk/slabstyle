# SLAB STYLE Car Care — üretim imajı
#
# Hedefler (target):
#   web     : Next.js (standalone). Vitrin modunda tek gereken budur (+ PostgreSQL).
#   migrate : migration + ilk kurulum (scripts/bootstrap.ts), sonra çıkar
#   worker  : BullMQ worker — yalnızca TAM MAĞAZA modunda gerekir (senkronizasyon,
#             sipariş iletimi). B2B panel okuması için Chromium içerdiğinden büyüktür.
#
# Web imajı bilinçli olarak küçük tutuldu (Chromium yok): sunucuda ~350 MB yer kaplar.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
# Derleme sırasında gerçek veritabanı gerekmez; Prisma config'i için yer tutucu.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
RUN mkdir -p /app/storage/uploads /app/storage/debug && chown -R app:app /app/storage
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

FROM deps AS migrate
COPY . .
ENV NODE_ENV=production
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx scripts/bootstrap.ts"]

# Yalnızca TAM MAĞAZA modunda kullanılır. Taban imaj Playwright'ındır (B2B bayi
# paneli okuması Chromium ister); sürümü package.json'daki playwright ile aynı olmalı.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS worker
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && mkdir -p /app/storage/uploads /app/storage/debug && chown -R pwuser:pwuser /app/storage /app/node_modules
USER pwuser
CMD ["npx", "tsx", "scripts/worker.ts"]
