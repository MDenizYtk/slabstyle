# SLAB STYLE Car Care

Oto bakım / detailing ürünleri için e-ticaret platformu. İki modda çalışır (`STORE_MODE`):

- **`showcase` — vitrin (varsayılan):** Ziyaretçiler admin panelinden eklenen ürünleri ve fotoğrafları
  görür, WhatsApp veya telefonla sipariş verir. Sepet, ödeme, stok takibi ve tedarikçi bağlantısı kapalıdır.
  Sadece uygulama + PostgreSQL çalışır.
- **`shop` — tam mağaza:** Sepet, ödeme (havale/EFT veya kart), sipariş yönetimi, stok rezervasyonu ve
  birden fazla B2B tedarikçiden otomatik fiyat/stok senkronizasyonu açılır. Sipariş arka planda ilgili
  tedarikçilere bölünür; tedarikçi adı ve alış fiyatı müşteriye hiçbir yerde gösterilmez.
  Ek olarak Redis ve worker gerekir.

Mod değişimi tek ortam değişkeni ile olur; kod her iki modda da aynıdır.

## Teknoloji

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · PostgreSQL 17 · Prisma 7 ·
Redis + BullMQ · Playwright (API'si olmayan B2B bayi panelleri) · Vitest

## Hızlı başlangıç (yerel)

```bash
./scripts/dev-services.sh        # PostgreSQL + Redis
cp .env.example .env              # değerleri doldurun (ENCRYPTION_KEY: openssl rand -base64 32)
npm install
npx playwright install chromium   # B2B panel adapter'ı için
npm run db:migrate                # şema
npm run db:seed                   # MOCK örnek veri + admin kullanıcı
npm run dev                       # http://localhost:4920
npm run worker                    # ayrı terminalde: senkronizasyon ve sipariş işleri
```

Worker çalıştırmadan denemek için `.env` içinde `QUEUE_INLINE=1` kullanılabilir (yalnızca yerel).

## Komutlar

| Komut | Açıklama |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu (port 4920) |
| `npm run worker` | BullMQ worker: sync, sipariş iletimi, zamanlayıcı |
| `npm run typecheck` | TypeScript kontrolü |
| `npm run lint` | ESLint |
| `npm test` | Birim testleri |
| `npm run test:integration` | Gerçek test veritabanında uçtan uca sipariş akışı |
| `npm run build` | Production build |
| `npm run check` | typecheck + lint + test + build |
| `npm run db:migrate` / `db:deploy` / `db:seed` | Veritabanı |

## Önemli klasörler

```
src/domain/        Saf iş kuralları (fiyat, stok, tedarikçi seçimi, eşleştirme, sipariş durumu, iade)
src/server/        Sunucu katmanı (auth, katalog, sepet, checkout, ödeme, sipariş, sync, tedarikçiler)
src/server/suppliers/adapters/   mock, manual, generic-feed, generic-rest, b2b-portal
src/app/(store)/   Mağaza sayfaları
src/app/admin/     Admin paneli
scripts/worker.ts  Arka plan worker'ı
prisma/            Şema, migration'lar, seed
docs/              Mimari, yol haritası, tedarikçi entegrasyon rehberi
```

## Dokümanlar

- [Mimari](docs/ARCHITECTURE.md)
- [Yol haritası ve durum](docs/ROADMAP.md)
- [Tedarikçi entegrasyonu (B2B panel, feed, API)](docs/SUPPLIER_INTEGRATION.md)
- [Canlıya alma: Hetzner + Coolify + Cloudflare](docs/DEPLOY.md)

## Üretime alma

`docker compose --env-file .env.production up -d --build` — web, worker, migration, PostgreSQL ve Redis.
Önünde TLS sonlandıran bir ters vekil (Caddy/Nginx/Coolify) olmalıdır. Kontrol listesi için
[docs/ROADMAP.md](docs/ROADMAP.md) içindeki "Canlıya almadan önce" bölümüne bakın.

## MOCK veriler

`MOCK Tedarikçi A/B/C`, markalar, barkodlar ve fiyatlar uydurmadır; yalnızca geliştirme içindir.
MOCK ödeme sağlayıcısı gerçek para çekmez ve üretimde `ALLOW_MOCK_PAYMENTS=1` olmadan çalışmaz.
