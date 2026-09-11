# Yol haritası ve durum

| # | Aşama | Durum |
| --- | --- | --- |
| 1 | Temel: şema, auth, roller, mağaza tasarımı, admin iskeleti, seed | Tamam |
| 2 | Tedarikçi adapter katmanı (MOCK, manual, feed, REST), şifreli kimlik bilgisi, bağlantı testi, dosya içe aktarımı | Tamam |
| 3 | Senkronizasyon: BullMQ, zamanlayıcı, stok/fiyat ve katalog işleri, güvenlik kuralları, admin sync ekranı | Tamam |
| 4 | Ürün eşleştirme: GTIN → MPN+marka → SKU → isim benzerliği → admin onayı | Tamam |
| 5 | Fiyat kuralları, arama (tam metin + trigram), filtreler, sayfalama | Tamam |
| 6 | Sepet ve checkout: sunucu tarafı doğrulama, stok rezervasyonu, idempotency | Tamam |
| 7 | Ödeme: sağlayıcı arayüzü, MOCK sağlayıcı, imzalı webhook, tekrar koruması, süre aşımı | Tamam |
| 8 | Sipariş dağıtımı: tedarikçi seçimi/bölme, otomatik/manuel iletim, kargo takibi | Tamam |
| 9 | İade ve refund | Tamam |
| 10 | Üretim: Docker, CI, dokümanlar, sağlık kontrolü | Tamam |
| + | B2B bayi paneli adapter'ı (Playwright) | Tamam — gerçek tedarikçi ayarları bekleniyor |
| + | Admin elle ürün ekleme, fotoğraf yükleme, kategori yönetimi, "Kendi Stoğum" | Tamam |

## Sıradaki işler

1. **Gerçek tedarikçiler:** her B2B panel için seçicilerin hazırlanması ve bağlantı testi.
2. **Gerçek ödeme sağlayıcısı** (iyzico veya PayTR): `src/server/payments/providers/` altına sınıf + CSP alan adları.
3. **E-posta bildirimleri:** sipariş alındı, kargoya verildi, iade sonucu (ör. Resend/SMTP).
4. **Yasal sayfalar:** mesafeli satış sözleşmesi, ön bilgilendirme, KVKK aydınlatma metni, çerez politikası.
5. **Fatura:** e-Arşiv entegrasyonu (Paraşüt, Logo vb.).
6. **Nesne depolama:** birden fazla sunucu için fotoğrafları S3 uyumlu depoya taşıma (`src/server/storage.ts`).
7. **Gözlemlenebilirlik:** hata izleme (Sentry), log toplama, sync başarısızlığında Telegram/e-posta uyarısı.
8. **B2B panelden otomatik sipariş girme:** tedarikçi paneli ve sözleşmesi uygunsa.
9. **Arama motoru:** katalog çok büyürse Meilisearch/OpenSearch (`src/server/catalog/search.ts`).

## Canlıya almadan önce

- [ ] `.env.production`: güçlü `ENCRYPTION_KEY`, `PAYMENT_WEBHOOK_SECRET`, veritabanı şifresi
- [ ] Seed admin şifresini değiştirin; demo müşteri ve MOCK tedarikçileri silin veya DISABLED yapın
- [ ] Gerçek ödeme sağlayıcısını bağlayın (`PAYMENT_PROVIDER`), `ALLOW_MOCK_PAYMENTS=0`
- [ ] TLS (HTTPS) ve alan adı; `APP_URL` doğru
- [ ] Veritabanı yedeği (günlük) ve `storage` volume yedeği
- [ ] Yasal sayfalar ve iletişim bilgileri
- [ ] Her B2B tedarikçiden otomatik erişim için yazılı onay
