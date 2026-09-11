# Tedarikçi entegrasyonu

Her tedarikçi bir **adapter** ile bağlanır. Adapter türü ve ayarları admin panelinden
(Tedarikçiler → Tedarikçi ekle) girilir; çoğu durumda kod yazmak gerekmez.

| Adapter | Ne zaman |
| --- | --- |
| `b2b-portal` | Tedarikçinin API'si yok, bayi paneline kullanıcı adı/şifre ile giriliyor |
| `generic-feed` | Tedarikçi XML / CSV / JSON ürün dosyasını bir URL'de yayınlıyor |
| `generic-rest` | Tedarikçinin sayfalı JSON API'si var |
| `manual` | Bağlantı yok; ürünler elle veya Excel/CSV ile yükleniyor (Kendi Stoğum da bu türdedir) |
| `mock` | Geliştirme ve test (gerçek bağlantı yok) |

Önerilen sıra: tedarikçiyi **PAUSED** kaydet → kimlik bilgilerini gir → **Bağlantıyı test et** →
örnek ürünler doğruysa **Katalog sync** çalıştır → eşleştirme ekranını kontrol et → **ACTIVE** yap.

---

## B2B bayi paneli (`b2b-portal`)

Sistem görünmez bir Chromium ile panele giriş yapar ve ürünleri okur. İki mod vardır:

- **`download`** (tercih edilen): Panelde "Excel'e aktar", "XML indir" gibi bir özellik varsa, giriş
  yapıldıktan sonra o dosya indirilir. Daha hızlı, daha az sayfa isteği, site tasarımı değişince bozulmaz.
- **`scrape`**: Ürün listesi sayfaları gezilir, her ürün kutusundan alanlar CSS seçicilerle okunur.

### Seçicileri bulmak

Tarayıcıda panele girin → bir ürüne sağ tıklayın → **İncele**. Ürün kutusunun ortak sınıfını
(`itemSelector`, ör. `.product-item`) ve kutunun içindeki alanların seçicilerini not edin.

### Örnek config (scrape)

```json
{
  "baseUrl": "https://bayi.tedarikci.com.tr",
  "login": {
    "url": "/giris",
    "usernameSelector": "input[name=email]",
    "passwordSelector": "input[type=password]",
    "submitSelector": "button[type=submit]",
    "successSelector": "a[href*=cikis]"
  },
  "products": {
    "mode": "scrape",
    "listUrls": ["/urunler?sayfa={page}"],
    "pagination": { "type": "urlTemplate", "startPage": 1, "maxPages": 100 },
    "itemSelector": ".urun-kart",
    "fields": {
      "supplierSku": { "selector": ".stok-kodu", "regex": "Kod:\\s*(\\S+)" },
      "title":       { "selector": ".urun-adi" },
      "costPrice":   { "selector": ".bayi-fiyat" },
      "stock":       { "selector": ".stok", "regex": "(\\d+)" },
      "gtin":        { "selector": ".barkod" },
      "brand":       { "selector": ".marka" },
      "images":      { "selector": "img", "attr": "src" }
    }
  },
  "priceFormat": { "decimalSeparator": ",", "vatIncluded": true, "vatRateBps": 2000 },
  "throttleMs": 1500
}
```

### Örnek config (download)

```json
{
  "baseUrl": "https://bayi.tedarikci.com.tr",
  "login": { "url": "/giris", "usernameSelector": "#kullanici", "passwordSelector": "#sifre", "submitSelector": "#girisBtn", "successSelector": ".hesabim" },
  "products": {
    "mode": "download",
    "exportPageUrl": "/urun-listesi",
    "exportClickSelector": "text=Excel'e Aktar",
    "format": "xlsx",
    "fieldMap": { "supplierSku": "Stok Kodu", "title": "Ürün Adı", "costPrice": "Bayi Fiyatı", "stock": "Stok", "gtin": "Barkod", "brand": "Marka" }
  },
  "priceFormat": { "decimalSeparator": ",", "vatIncluded": false, "vatRateBps": 2000 }
}
```

### Alan referansı

| Alan | Açıklama |
| --- | --- |
| `login.successSelector` | Yalnızca giriş yapılınca görünen öğe; girişin başarılı olduğu buradan anlaşılır |
| `login.beforeSteps` / `afterSteps` | Ek adımlar: `goto`, `fill`, `click`, `select`, `waitFor`, `wait`. Değerlerde `{{username}}`, `{{password}}` kullanılabilir |
| `fields.*.selector` | Ürün kutusu içindeki seçici; boşsa kutunun kendisi |
| `fields.*.attr` | `text` (varsayılan), `href`, `src` veya herhangi bir HTML özelliği (`data-sku` gibi) |
| `fields.*.regex` | Değerden ilk yakalama grubunu alır (ör. "Stok: 12 adet" → `(\d+)`) |
| `pagination.type` | `none`, `urlTemplate` (`{page}` yer tutucusu), `nextButton` (`nextSelector` gerekir) |
| `priceFormat.vatIncluded` | Panel fiyatı KDV hariçse `false`; sistem KDV ekler |
| `download.encoding` | Türkçe CSV'ler için sık görülen: `windows-1254` |
| `throttleMs` | Sayfalar arası bekleme (en az 500 ms). Paneli yormamak için yüksek tutun |

### Kurallar ve sınırlar

- **CAPTCHA:** Sistem CAPTCHA / robot doğrulamasını aşmaya çalışmaz; görürse durur ve admin'e bildirir.
  Bu durumda tedarikçiden dışa aktarım dosyası, feed ya da API isteyin.
- **Sözleşme:** Bazı tedarikçiler paneline otomatik erişimi yasaklar. Her tedarikçiden yazılı onay alın.
- **Sıklık:** B2B panellerde stok senkronizasyonunu 30-60 dakikanın altına düşürmeyin.
- **Hata ekranı:** Giriş veya okuma başarısız olursa ekran görüntüsü alınır; adresi hata mesajında yer alır
  (`/admin/portal-debug/...`, yalnızca admin görebilir).
- **Siparişler:** Bu adapter siparişi otomatik girmez. Sipariş geldiğinde admin → Siparişler ekranında
  tedarikçi SKU'larını görür, panele girer ve "Tedarikçiye verildi" + kargo bilgisini işaretler.

---

## Feed (`generic-feed`) ve REST (`generic-rest`)

Admin formundaki **Şablonu yükle** butonu örnek config'i doldurur. URL'ler bilerek yer tutucudur;
gerçek adres girilmeden kaydedilemez. Alan eşlemesi (`fieldMap`) tedarikçinin alan adlarını bizimkine bağlar;
iç içe alanlar için nokta kullanılır (`fiyat.bayi`).

## Özel adapter yazmak

Config yetmiyorsa (imzalı API, SOAP, özel sipariş akışı):

1. `src/server/suppliers/adapters/<tedarikci>.ts` — `SupplierAdapter` arayüzünü uygulayın
   (gerekirse `RestSupplierAdapter` veya `PortalSupplierAdapter` sınıfını extend edin).
2. `src/server/suppliers/registry.ts` içine tek kayıt ekleyin.
3. Sipariş iletiminde `payload.reference` (bizim SupplierOrder id'miz) tedarikçiye iletilmeli;
   tekrar denemede çift sipariş oluşmasını önler.

## Senkronizasyon güvenliği

- Hatalı satırlar atlanır, iş **PARTIAL** biter; doğru satırlar yazılır.
- Adapter hata verirse iş **FAILED** olur; mevcut veri **silinmez**.
- Feed boş gelirse veya aktif ürünlerin %30'undan fazlası kaybolursa ürünler kaldırılmaz.
- Maliyette %70'ten büyük ani değişim uygulanmaz ve raporlanır.
- Başarısız zamanlanmış işler 2, 4 dakika arayla en fazla 3 kez tekrar denenir.
