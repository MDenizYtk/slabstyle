/**
 * Varsayılan kategori yapısı (oto bakım / detailing). Canlı ortamın ilk kurulumunda
 * (scripts/bootstrap.ts) ve geliştirme seed'inde kullanılır; admin panelinden değiştirilebilir.
 */
export const DEFAULT_CATEGORIES: { slug: string; name: string; description: string; parent?: string }[] = [
  { slug: "yikama-sampuan", name: "Yıkama & Şampuan", description: "pH nötr şampuanlar, ön yıkama köpükleri ve yıkama ekipmanları." },
  { slug: "cila-pasta", name: "Cila & Pasta", description: "Çizik giderici pastalar, cilalar ve wax ürünleri." },
  { slug: "polisaj-pastalari", name: "Polisaj Pastaları", description: "Kalın, orta ve ince kesim pastalar.", parent: "cila-pasta" },
  { slug: "cila-wax", name: "Cila & Wax", description: "Karnauba wax ve sentetik cilalar.", parent: "cila-pasta" },
  { slug: "seramik-kaplama-koruma", name: "Seramik Kaplama & Koruma", description: "Uzun ömürlü seramik kaplamalar ve sprey koruyucular." },
  { slug: "jant-lastik", name: "Jant & Lastik", description: "Jant temizleyiciler, demir tozu sökücüler ve lastik parlatıcılar." },
  { slug: "ic-temizlik", name: "İç Temizlik", description: "Döşeme, deri, plastik ve cam bakım ürünleri." },
  { slug: "mikrofiber-aksesuar", name: "Mikrofiber & Aksesuar", description: "Kurulama havluları, aplikatörler ve fırçalar." },
  { slug: "makine-ekipman", name: "Makine & Ekipman", description: "Polisaj makineleri, köpük tabancaları ve pedler." },
];

/** Kullanıcının belirlediği kademeli marj: <500 TL %30, 500–1500 TL %25, 1500 TL üzeri %20. */
export const DEFAULT_PRICING_TIERS = [
  { id: "rule-tier-1", name: "Maliyet < 500 TL → %30", minCost: null, maxCost: 50_000, marginBps: 3000 },
  { id: "rule-tier-2", name: "500–1500 TL → %25", minCost: 50_000, maxCost: 150_000, marginBps: 2500 },
  { id: "rule-tier-3", name: "1500 TL üzeri → %20", minCost: 150_000, maxCost: null, marginBps: 2000 },
] as const;
