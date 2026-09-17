# Canlıya alma: Hetzner + Coolify + Cloudflare (slabstylecar.com)

Sunucu: Hetzner `46.225.231.222` (Coolify kurulu, Atlas ile aynı sunucu).
Alan adı: `slabstylecar.com` (Cloudflare).
Kurulum `docker-compose.coolify.yml` ile yapılır. Varsayılan **vitrin modunda** yalnızca
uygulama + PostgreSQL çalışır (sunucuda ~350 MB imaj, ~250 MB bellek); Redis ve worker gerekmez.

## 1. Kodu GitHub'a gönder

```bash
cd ~/Projects/slabstyle
gh repo create MDenizYtk/slabstyle --public --source . --remote origin --push
```

Repo public olsa da gizli bilgi içermez: `.env`, `storage/` (yüklenen fotoğraflar) ve üretilen dosyalar
`.gitignore` ile dışarıda kalır. Tüm şifreler yalnızca Coolify'da tutulur.

## 2. Gizli değerleri üret (kendi terminalinde)

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 32      # PAYMENT_WEBHOOK_SECRET
```

Çıktıları sohbete yapıştırma; doğrudan Coolify'a gir. **ENCRYPTION_KEY bir kez girildikten sonra
değiştirilmemeli** — tedarikçi şifreleri bu anahtarla şifrelenir, değişirse okunamaz.

## 3. Coolify'da uygulamayı oluştur

1. Coolify → **Projects** → (yeni proje: `SLAB STYLE`) → **+ New** → **Resource**.
2. **Private Repository (with GitHub App)** seç (repo public olsa da bu yol `main`'e her push'ta
   otomatik deploy sağlar; Atlas'taki GitHub App'i kullan) → `MDenizYtk/slabstyle` → branch `main`.
3. **Build Pack: Docker Compose**.
4. **Docker Compose Location:** `/docker-compose.coolify.yml` → **Continue / Load**.

## 4. Ortam değişkenleri (Environment Variables)

| Değişken | Değer |
| --- | --- |
| `APP_URL` | `https://slabstylecar.com` |
| `STORE_MODE` | `showcase` (vitrin). Tam mağazaya geçince `shop` |
| `ENCRYPTION_KEY` | 2. adımdaki base64 değer |
| `SEED_ADMIN_EMAIL` | admin giriş e-postan |
| `SEED_ADMIN_PASSWORD` | en az 12 karakter, güçlü bir şifre (yalnızca ilk kurulumda kullanılır) |
| `TRUST_CLOUDFLARE` | `1` |
| `SESSION_TTL_DAYS` | `30` |

Vitrin modunda Redis, worker ve ödeme değişkenleri **gerekmez**. Tam mağazaya geçerken eklenecekler:
`STORE_MODE=shop`, `REDIS_URL`, `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET` (`openssl rand -hex 32`),
`ALLOW_MOCK_PAYMENTS=0` ve compose dosyasındaki `redis` + `worker` servislerinin açılması.

`SERVICE_PASSWORD_POSTGRES` Coolify tarafından otomatik üretilir; dokunma.

## 5. Alan adını web servisine bağla

Coolify'da uygulamanın servis listesinde **web** → **Domains** alanına:

```
https://slabstylecar.com:3000,https://www.slabstylecar.com:3000
```

(`:3000` container içindeki portu belirtir; ziyaretçiler normal `https://slabstylecar.com` ile girer.)
Diğer servislere (worker, migrate, postgres, redis) alan adı verme.

## 6. Cloudflare DNS

Cloudflare → `slabstylecar.com` → **DNS** → **Records**:

| Tür | Ad | İçerik | Proxy |
| --- | --- | --- | --- |
| A | `@` | `46.225.231.222` | **DNS only (gri bulut)** |
| A | `www` | `46.225.231.222` | **DNS only (gri bulut)** |

İlk kurulumda gri bulut şart: Coolify SSL sertifikasını (Let's Encrypt) bu şekilde alır.

## 7. Deploy

Coolify → **Deploy**. İlk build 10-20 dakika sürebilir (Playwright imajı büyüktür, sunucuda 2 çekirdek var).
Log'larda:
- `migrate` servisi migration'ları uygular, `Bootstrap: admin oluşturuldu …` yazar ve **kapanır** (normal).
- `web` ve `worker` "running/healthy" olur.

Kontrol:

```bash
curl -s https://slabstylecar.com/api/health
# {"ok":true,"database":true,"redis":true,...}
```

## 8. Cloudflare proxy'yi aç

Site `https://` ile açıldıktan sonra:
1. DNS kayıtlarını **Proxied (turuncu bulut)** yap.
2. **SSL/TLS → Overview → Full (strict)**.
3. **SSL/TLS → Edge Certificates → Always Use HTTPS: On**.

## 9. İlk giriş ve temizlik

1. `https://slabstylecar.com/login` → `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`.
2. Admin → **Ayarlar**: WhatsApp numaranı, telefon ve e-postanı gir. Ziyaretçiler ürün sayfasındaki
   butonla buradan sipariş verir (vitrin modu).
3. Admin → **Kategoriler**'i düzenle, **Yeni ürün** ile ürünleri ve fotoğrafları ekle.
4. Coolify'dan `SEED_ADMIN_PASSWORD` değişkenini sil (artık gerekmez; admin varken kullanılmaz).

Canlı veritabanı boş başlar: MOCK tedarikçiler ve örnek ürünler **yoktur**.

## Güncelleme

`git push origin main` → Coolify otomatik build + deploy. Migration'lar `migrate` servisinde otomatik uygulanır.

## Yedekleme (önerilir)

Günlük veritabanı yedeği için sunucuda (Coolify → Server → Terminal veya SSH):

```bash
docker exec $(docker ps -qf "name=postgres" -f "label=coolify.projectName=SLAB STYLE" | head -1) \
  pg_dump -U slabstyle slabstyle | gzip > /root/backups/slabstyle-$(date +%F).sql.gz
```

Fotoğraflar `slabstyle-storage` volume'undadır; onu da yedekleyin.

## Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| Build sırasında bellek hatası / takılma | Sunucuda 3,8 GB RAM var. Deploy sırasında kullanılmayan uygulamaları geçici durdurun veya sunucuyu CX32'ye yükseltin. |
| `migrate` hata verdi: SEED_ADMIN… gerekli | 4. adımdaki admin değişkenlerini girin, tekrar deploy. |
| SSL alınamıyor | Cloudflare kayıtları gri bulut olmalı, A kaydı doğru IP'yi göstermeli. |
| Ödeme adımında hata | Beklenen: gerçek ödeme sağlayıcısı bağlanana kadar ödeme alınamaz. |
