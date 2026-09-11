/**
 * Ana sayfa kampanya bannerları. İleride admin panelinden yönetilecek bir
 * Campaign modeline taşınabilir; şimdilik içerik olarak burada tutulur.
 */
export type Campaign = { id: string; eyebrow: string; title: string; body: string; href: string; cta: string };

export const campaigns: Campaign[] = [
  {
    id: "ceramic",
    eyebrow: "Sezon kampanyası",
    title: "Seramik koruma haftası",
    body: "Seramik kaplama ve sprey koruyucularda seçili ürünlerde indirim.",
    href: "/categories/seramik-kaplama-koruma",
    cta: "Ürünleri gör",
  },
  {
    id: "starter",
    eyebrow: "Yeni başlayanlar",
    title: "İki kova yıkama seti",
    body: "Şampuan, mikrofiber eldiven ve kurulama havlusu ile güvenli yıkama.",
    href: "/categories/yikama-sampuan",
    cta: "Seti oluştur",
  },
];
