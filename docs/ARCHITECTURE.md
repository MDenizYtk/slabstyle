# Mimari

## Genel akış

```
Müşteri → Mağaza (Next.js) → Sepet → Checkout ──► Order (PENDING_PAYMENT, stok rezerve)
                                                   │
Ödeme sağlayıcısı ── imzalı webhook ──────────────►│ Payment CAPTURED → Order PAID
                                                   ▼
                                  Tedarikçi seçimi (fiyat/stok/öncelik)
                                                   ▼
                            SupplierOrder (tedarikçi başına bir alt sipariş)
                          ┌────────────────────────┴───────────────────────┐
                 API destekli: otomatik iletim             API yok: admin panelinden manuel
                          └────────────────────────┬───────────────────────┘
                                                   ▼
                              Kargo (API / webhook / admin girişi) → Shipment
                                                   ▼
                          Order durumu alt siparişlerden türetilir → müşteri takip eder
```

## Katmanlar

- **`src/domain/`** — Saf fonksiyonlar, veritabanı ve framework bağımsız. Fiyat motoru, safety stock,
  tedarikçi seçimi ve bölme, eşleştirme kararı, sipariş durum geçişleri, iade tutarı, sync güvenlik kuralları.
  Testlerin çoğu burayı hedefler.
- **`src/server/`** — Veritabanı ve dış dünya. Her modül kendi sorumluluğunu taşır:
  `auth` (oturum, DAL), `catalog` (sorgular, DTO, yeniden hesaplama), `cart`, `orders` (checkout, dağıtım,
  rezervasyon), `payments` (sağlayıcı, webhook, refund), `sync` (motor, zamanlayıcı), `suppliers` (adapter'lar),
  `matching`, `storage`.
- **`src/app/`** — Sayfalar, server action'lar, route handler'lar (webhook, sağlık, medya).
- **`scripts/worker.ts`** — BullMQ worker'ı; web sürecinden bağımsız ölçeklenir.

## Temel kararlar

| Karar | Neden |
| --- | --- |
| Para kuruş cinsinden `Int` | Kayan nokta hatası yok; tüm hesaplar tam sayı |
| `Product/ProductVariant` ↔ `SupplierProduct` ayrımı | Müşteri kimliği ile tedarikçi SKU'su bağımsız; bir ürün birçok tedarikçide |
| Müşteri tarafı yalnızca DTO select'leri | Tedarikçi adı / alış fiyatı sızmaz (testle korunur) |
| Oturum: DB'de hash'lenmiş rastgele token | İptal edilebilir, DB sızıntısında oturum çalınamaz |
| Stok rezervasyonu checkout'ta, koşullu UPDATE | Aynı anda iki müşteri son ürünü alamaz |
| `idempotencyKey` (Order, Payment, Refund) + `WebhookEvent` tekilliği | Çift gönderim / tekrar gelen webhook çoğaltma yapmaz |
| Sync: satır hatası işi düşürmez, boş feed hiçbir şeyi silmez | Tedarikçi tarafı hataları doğru veriyi bozmaz |
| Kaldırma oranı ve ani fiyat değişimi eşikleri | Yarım/yanlış feed'e karşı koruma |
| Adapter kayıt defteri + config | Tedarikçi API'si değişince yalnızca o adapter/config değişir |
| Eşleştirmede yalnızca tek ve çelişkisiz GTIN / MPN+marka otomatik | Belirsiz durumlar admin onayına düşer |
| Denormalize `Product.minPrice/totalAvailable/searchText/searchVector` | 100 bin+ üründe hızlı listeleme ve arama (GIN) |
| Ödeme sağlayıcı arayüzü | iyzico/PayTR/Stripe tek sınıfla eklenir |

## Stok modeli

```
supplierQty   = Σ tedarikçi stoğu (aktif teklifler)
sellable      = Σ max(0, stok − safetyStock)
availableQty  = sellable − reservedQty          (müşteriye gösterilen)
```

- Checkout: `reservedQty += q`, `availableQty -= q` (koşullu).
- Tedarikçiye iletim: `reservedQty -= q` (tedarikçi stoğu sonraki sync'te zaten düşer).
- İptal / ödeme süresi dolması: `reservedQty -= q`, `availableQty += q`.

## Fiyat

`satış = maliyet + ⌈maliyet × marj⌉ + sabit ek` → minimum marj ve minimum kâr tabanları → yuvarlama (yalnızca yukarı).
Kural seçimi: öncelik → kapsam (tedarikçi > kategori > marka > genel) → dar maliyet aralığı.
Admin elle fiyat girerse kural o varyant için devre dışı kalır.

## Güvenlik özeti

- Rol tabanlı yetki: CUSTOMER / STAFF / ADMIN; kontrol her sayfa, action ve route'ta DAL üzerinden.
- Proxy yalnızca iyimser cookie kontrolü yapar.
- Argon2id parola, giriş ve kayıt için rate limit, kullanıcı adı keşfine karşı sabit süre.
- Zod ile tüm girdi doğrulaması; Prisma parametreli sorgular; raw SQL'de parametre bağlama.
- CSP, HSTS, X-Frame-Options, nosniff başlıkları; server action'larda Next'in origin kontrolü.
- Tedarikçi kimlik bilgileri AES-256-GCM ile şifreli; forma geri gönderilmez; log'larda maskelenir.
- Webhook: HMAC-SHA256 imza + zaman damgası toleransı.
- Tedarikçi URL'lerinde SSRF koruması (üretimde özel IP engeli).
- Yüklenen dosyalarda sihirli bayt kontrolü; public dışında saklanır.
- Kullanıcılar yalnızca kendi siparişlerine erişir (her sorguda `userId` koşulu).
