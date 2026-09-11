/**
 * ─────────────────────────────────────────────────────────────────────────
 *  MOCK VERİ — GERÇEK TEDARİKÇİ DEĞİLDİR.
 *  Markalar, barkodlar, SKU'lar ve fiyatlar tamamen uydurmadır. Sistem
 *  geliştirme ve test için kullanılır. Gerçek tedarikçiler eklendiğinde bu
 *  dosya yalnızca seed ve "mock" adapter tarafından kullanılmaya devam eder.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { makeEan13 } from "@/domain/matching/gtin";

export type MockVariant = { name: string; options: Record<string, string>; gtin: string; mpn: string; baseCost: number };
export type MockProduct = {
  key: string;
  name: string;
  brand: string;
  category: string;
  image: string;
  shortDesc: string;
  description: string;
  specs: { label: string; value: string }[];
  featured?: boolean;
  variants: MockVariant[];
};

export const MOCK_BRANDS = ["SLAB Pro", "Nordwax", "AquaShield", "Detail Lab", "Kratos Chem", "Polaris Tools"] as const;

// Kategoriler gerçek mağaza yapısıdır (MOCK değildir); ortak dosyadan gelir.
export { DEFAULT_CATEGORIES as MOCK_CATEGORIES } from "@/content/categories";

let seq = 0;
const gtin = () => makeEan13(`869999${String(++seq).padStart(6, "0")}`);
const vol = (sizes: [string, number][], mpnBase: string): MockVariant[] =>
  sizes.map(([size, cost], i) => ({ name: size, options: { Hacim: size }, gtin: gtin(), mpn: `${mpnBase}-${i + 1}`, baseCost: cost }));
const single = (cost: number, mpn: string, name = "Standart"): MockVariant[] => [{ name, options: {}, gtin: gtin(), mpn, baseCost: cost }];

export const MOCK_PRODUCTS: MockProduct[] = [
  { key: "sampuan-ph", name: "pH Nötr Konsantre Oto Şampuanı", brand: "SLAB Pro", category: "yikama-sampuan", image: "bottle", featured: true,
    shortDesc: "Koruma katmanlarına zarar vermeyen, yoğun köpüklü pH nötr şampuan.",
    description: "Seramik kaplama ve wax katmanlarını koruyarak kiri güvenle çözer.\n1:500 oranında seyreltilerek kullanılır.",
    specs: [{ label: "pH", value: "7" }, { label: "Seyreltme", value: "1:500" }, { label: "Koku", value: "Karpuz" }],
    variants: vol([["500 ml", 18_000], ["1 L", 29_000], ["5 L", 110_000]], "SP-PHN") },
  { key: "kopuk", name: "Snow Foam Ön Yıkama Köpüğü", brand: "AquaShield", category: "yikama-sampuan", image: "bottle", featured: true,
    shortDesc: "Temas öncesi kiri yumuşatan yoğun ön yıkama köpüğü.",
    description: "Köpük tabancası ile uygulanır, 3-5 dakika bekletilip durulanır.",
    specs: [{ label: "Seyreltme", value: "1:10 (köpük tabancası)" }, { label: "pH", value: "10" }],
    variants: vol([["1 L", 24_000], ["5 L", 89_000]], "AQ-SF") },
  { key: "susuz-yikama", name: "Susuz Yıkama Spreyi", brand: "Detail Lab", category: "yikama-sampuan", image: "spray",
    shortDesc: "Hafif kirli araçlar için pratik susuz yıkama.",
    description: "Polimer formülü kiri kapsülleyerek çizik riskini azaltır.",
    specs: [{ label: "Kullanım", value: "Hazır" }],
    variants: vol([["750 ml", 21_000]], "DL-WL") },
  { key: "pasta-kalin", name: "Heavy Cut Kalın Pasta", brand: "Kratos Chem", category: "polisaj-pastalari", image: "jar", featured: true,
    shortDesc: "Derin çizikler için yüksek kesim gücüne sahip pasta.",
    description: "Rotary ve orbital makinelerde kullanılabilir. Tozuma yapmaz.",
    specs: [{ label: "Kesim", value: "10/10" }, { label: "Parlaklık", value: "6/10" }],
    variants: vol([["250 ml", 32_000], ["1 L", 95_000]], "KC-HC") },
  { key: "pasta-orta", name: "One Step Orta Pasta", brand: "Kratos Chem", category: "polisaj-pastalari", image: "jar",
    shortDesc: "Tek adımda çizik giderme ve parlaklık.",
    description: "Hafif ve orta çizikleri giderirken yüksek parlaklık bırakır.",
    specs: [{ label: "Kesim", value: "6/10" }, { label: "Parlaklık", value: "8/10" }],
    variants: vol([["250 ml", 29_000], ["1 L", 86_000]], "KC-OS") },
  { key: "pasta-ince", name: "Finish Hare Giderici", brand: "Kratos Chem", category: "polisaj-pastalari", image: "jar",
    shortDesc: "Hologram ve hareleri gideren ince bitiş pastası.",
    description: "Koyu renkli araçlarda derin ayna parlaklığı sağlar.",
    specs: [{ label: "Kesim", value: "2/10" }, { label: "Parlaklık", value: "10/10" }],
    variants: vol([["250 ml", 27_000], ["1 L", 80_000]], "KC-FN") },
  { key: "karnauba", name: "Karnauba Katı Wax", brand: "Nordwax", category: "cila-wax", image: "jar", featured: true,
    shortDesc: "Brezilya karnaubası ile sıcak, derin parlaklık.",
    description: "Tek katmanda 2-3 ay koruma. Elle uygulanır, 10 dakika sonra silinir.",
    specs: [{ label: "Dayanım", value: "2-3 ay" }, { label: "Karnauba oranı", value: "%30" }],
    variants: vol([["200 g", 68_000]], "NW-KW") },
  { key: "sprey-wax", name: "Hızlı Sprey Wax", brand: "Nordwax", category: "cila-wax", image: "spray",
    shortDesc: "Yıkama sonrası 5 dakikada parlaklık ve su itici etki.",
    description: "Islak ya da kuru yüzeye uygulanabilir.",
    specs: [{ label: "Dayanım", value: "4-6 hafta" }],
    variants: vol([["500 ml", 19_000], ["1 L", 31_000]], "NW-SW") },
  { key: "seramik-9h", name: "9H Seramik Kaplama Kiti", brand: "SLAB Pro", category: "seramik-kaplama-koruma", image: "bottle", featured: true,
    shortDesc: "3 yıla kadar koruma sağlayan profesyonel seramik kaplama.",
    description: "Kit içeriği: 30 ml kaplama, aplikatör, süet bezler, yüzey hazırlayıcı.\nUygulama öncesi pasta ve IPA silme önerilir.",
    specs: [{ label: "Sertlik", value: "9H" }, { label: "Dayanım", value: "36 ay" }, { label: "Kapsama", value: "1 araç" }],
    variants: vol([["30 ml", 180_000], ["50 ml", 260_000]], "SP-C9H") },
  { key: "seramik-sprey", name: "Seramik Sprey Koruyucu", brand: "AquaShield", category: "seramik-kaplama-koruma", image: "spray", featured: true,
    shortDesc: "SiO2 bazlı, püskürt-sil seramik koruma.",
    description: "Kaplamalı araçlarda bakım ürünü olarak da kullanılır.",
    specs: [{ label: "Dayanım", value: "6 ay" }, { label: "İçerik", value: "SiO2" }],
    variants: vol([["500 ml", 34_000], ["1 L", 58_000]], "AQ-CS") },
  { key: "cam-su-itici", name: "Cam Su İtici", brand: "AquaShield", category: "seramik-kaplama-koruma", image: "spray",
    shortDesc: "Yağmurda görüşü iyileştiren cam kaplama.",
    description: "Temiz ve kuru cama uygulanır, 70 km/s üzerinde su damlaları uçar.",
    specs: [{ label: "Dayanım", value: "3 ay" }],
    variants: vol([["100 ml", 14_000]], "AQ-GL") },
  { key: "jant-temizleyici", name: "Asit İçermeyen Jant Temizleyici", brand: "Detail Lab", category: "jant-lastik", image: "tire", featured: true,
    shortDesc: "Tüm jant tiplerinde güvenli, renk değiştiren formül.",
    description: "Demir tozlarıyla tepkimeye girerek mora döner.",
    specs: [{ label: "pH", value: "7.5" }, { label: "Uygun jant", value: "Alüminyum, krom, boyalı" }],
    variants: vol([["500 ml", 22_000], ["1 L", 36_000]], "DL-WC") },
  { key: "lastik-parlatici", name: "Mat Lastik Bakım Jeli", brand: "Detail Lab", category: "jant-lastik", image: "tire",
    shortDesc: "Doğal mat görünüm, savrulma yapmayan jel.",
    description: "Aplikatör süngerle ince katman uygulanır.",
    specs: [{ label: "Görünüm", value: "Saten mat" }],
    variants: vol([["500 ml", 16_000]], "DL-TG") },
  { key: "demir-tozu", name: "Demir Tozu Sökücü", brand: "Kratos Chem", category: "jant-lastik", image: "spray",
    shortDesc: "Boya ve jantlardaki metal parçacıklarını söker.",
    description: "Pasta ve kaplama öncesi dekontaminasyon adımı.",
    specs: [{ label: "Tepkime", value: "Mor renk" }],
    variants: vol([["500 ml", 23_000], ["1 L", 39_000]], "KC-IR") },
  { key: "doseme", name: "Döşeme ve Halı Temizleyici", brand: "SLAB Pro", category: "ic-temizlik", image: "spray",
    shortDesc: "Kumaş koltuk ve halılarda derin temizlik.",
    description: "Leke üzerine püskürtün, fırçalayın, mikrofiber ile alın.",
    specs: [{ label: "Koku", value: "Temiz pamuk" }],
    variants: vol([["500 ml", 17_000], ["5 L", 72_000]], "SP-UP") },
  { key: "deri-bakim", name: "Deri Temizleme ve Bakım Seti", brand: "Nordwax", category: "ic-temizlik", image: "bottle",
    shortDesc: "Deri koltuklar için temizleyici ve besleyici.",
    description: "Set içeriği: 250 ml temizleyici, 250 ml besleyici, deri fırçası.",
    specs: [{ label: "İçerik", value: "2 x 250 ml + fırça" }],
    variants: single(41_000, "NW-LS", "Set") },
  { key: "torpido", name: "Torpido ve Plastik Bakım", brand: "Detail Lab", category: "ic-temizlik", image: "spray",
    shortDesc: "UV korumalı, toz tutmayan saten bitiş.",
    description: "İç plastik, torpido ve kapı döşemelerinde kullanılır.",
    specs: [{ label: "UV koruma", value: "Var" }],
    variants: vol([["500 ml", 15_000]], "DL-DB") },
  { key: "cam-temizleyici", name: "İz Bırakmayan Cam Temizleyici", brand: "AquaShield", category: "ic-temizlik", image: "spray",
    shortDesc: "Amonyak içermez, film tabakalarına güvenli.",
    description: "İç ve dış camlarda iz bırakmadan temizler.",
    specs: [{ label: "Amonyak", value: "Yok" }],
    variants: vol([["500 ml", 12_000]], "AQ-GC") },
  { key: "kurulama-havlusu", name: "Twisted Loop Kurulama Havlusu", brand: "SLAB Pro", category: "mikrofiber-aksesuar", image: "cloth", featured: true,
    shortDesc: "Tek geçişte tüm kaputu kurulayan 1200 GSM havlu.",
    description: "Çizik riskini en aza indiren kenarsız yapı.",
    specs: [{ label: "GSM", value: "1200" }, { label: "Kenar", value: "Lazer kesim" }],
    variants: [
      { name: "50x60 cm", options: { Ölçü: "50x60 cm" }, gtin: gtin(), mpn: "SP-DT-S", baseCost: 16_000 },
      { name: "60x90 cm", options: { Ölçü: "60x90 cm" }, gtin: gtin(), mpn: "SP-DT-L", baseCost: 24_000 },
    ] },
  { key: "mikrofiber-set", name: "Çok Amaçlı Mikrofiber Bez Seti", brand: "SLAB Pro", category: "mikrofiber-aksesuar", image: "cloth",
    shortDesc: "Cila silme ve genel kullanım için 6'lı set.",
    description: "400 GSM, 40x40 cm, kenarsız.",
    specs: [{ label: "Adet", value: "6" }, { label: "GSM", value: "400" }],
    variants: single(13_000, "SP-MF6", "6'lı set") },
  { key: "yikama-eldiveni", name: "Şönil Yıkama Eldiveni", brand: "AquaShield", category: "mikrofiber-aksesuar", image: "cloth",
    shortDesc: "Kiri liflerin arasına hapseden yumuşak eldiven.",
    description: "Makinede 40 derecede yıkanabilir.",
    specs: [{ label: "Malzeme", value: "Şönil mikrofiber" }],
    variants: single(9_000, "AQ-WM") },
  { key: "polisaj-makinesi", name: "DA Orbital Polisaj Makinesi 15 mm", brand: "Polaris Tools", category: "makine-ekipman", image: "machine", featured: true,
    shortDesc: "Hologram bırakmayan, yeni başlayanlar için güvenli orbital makine.",
    description: "Kutu içeriği: makine, 125 mm tabanlık, 3 ped, taşıma çantası.",
    specs: [{ label: "Güç", value: "900 W" }, { label: "Orbit", value: "15 mm" }, { label: "Devir", value: "2000-5000 opm" }],
    variants: single(420_000, "PT-DA15") },
  { key: "kopuk-tabancasi", name: "Köpük Tabancası (Basınçlı Yıkama)", brand: "Polaris Tools", category: "makine-ekipman", image: "machine",
    shortDesc: "Yoğun köpük için ayarlanabilir memeli tabanca.",
    description: "Farklı basınçlı yıkama makineleri için adaptörlü.",
    specs: [{ label: "Hazne", value: "1 L" }, { label: "Bağlantı", value: "1/4\" quick connect" }],
    variants: single(38_000, "PT-FL") },
  { key: "ped-seti", name: "Polisaj Ped Seti 125 mm", brand: "Polaris Tools", category: "makine-ekipman", image: "machine",
    shortDesc: "Kesim, orta ve bitiş için 3'lü sünger ped.",
    description: "Cırtlı tabanlıklarla uyumludur.",
    specs: [{ label: "Çap", value: "125 mm" }, { label: "Adet", value: "3" }],
    variants: single(21_000, "PT-PAD3") },
];

export type MockSupplierDef = {
  code: string;
  name: string;
  priority: number;
  safetyStock: number;
  leadTimeDays: number;
  /** Maliyet çarpanı (baz puan): 10_000 = aynen. */
  costFactorBps: number;
  /** Bu tedarikçide bulunan ürünlerin oranı (deterministik seçim). */
  coverage: number;
  skuPrefix: string;
};

export const MOCK_SUPPLIERS: MockSupplierDef[] = [
  { code: "mock-a", name: "MOCK Tedarikçi A", priority: 10, safetyStock: 2, leadTimeDays: 2, costFactorBps: 10_000, coverage: 1, skuPrefix: "A" },
  { code: "mock-b", name: "MOCK Tedarikçi B", priority: 5, safetyStock: 1, leadTimeDays: 1, costFactorBps: 9_600, coverage: 0.6, skuPrefix: "B" },
  { code: "mock-c", name: "MOCK Tedarikçi C", priority: 0, safetyStock: 0, leadTimeDays: 4, costFactorBps: 10_800, coverage: 0.4, skuPrefix: "C" },
];

/** Deterministik sözde-rastgele sayı (aynı girdi → aynı çıktı). */
export function hashRandom(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

export type MockOffer = {
  supplierCode: string;
  supplierSku: string;
  productKey: string;
  variantIndex: number;
  title: string;
  brandName: string;
  gtin: string;
  mpn: string;
  costPrice: number;
  stock: number;
};

/**
 * Bir tedarikçinin MOCK kataloğunu üretir. `tick` değiştikçe stok ve fiyat
 * hafifçe oynar; bu sayede senkronizasyon işleri gerçekçi değişiklik görür.
 */
export function mockCatalogFor(supplier: MockSupplierDef, tick = 0): MockOffer[] {
  const offers: MockOffer[] = [];
  MOCK_PRODUCTS.forEach((product) => {
    if (hashRandom(`${supplier.code}:${product.key}`) > supplier.coverage) return;
    product.variants.forEach((variant, vi) => {
      const r = hashRandom(`${supplier.code}:${product.key}:${vi}:${tick}`);
      const drift = 9_700 + Math.floor(r * 600); // ±%3 fiyat oynaması
      const cost = Math.round((variant.baseCost * supplier.costFactorBps * drift) / 100_000_000);
      const stock = r < 0.12 ? 0 : Math.floor(r * 60);
      offers.push({
        supplierCode: supplier.code,
        supplierSku: `${supplier.skuPrefix}-${variant.mpn}`,
        productKey: product.key,
        variantIndex: vi,
        // Tedarikçiler aynı ürüne farklı isim verebilir: eşleştirme barkod ile yapılır.
        title: supplier.code === "mock-b" ? `${product.brand.toUpperCase()} ${product.name} ${variant.name}` : `${product.name} - ${variant.name}`,
        brandName: product.brand,
        gtin: variant.gtin,
        mpn: variant.mpn,
        costPrice: Math.round(cost / 10) * 10,
        stock,
      });
    });
  });
  return offers;
}
