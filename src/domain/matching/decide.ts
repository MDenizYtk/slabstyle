/**
 * Ürün eşleştirme kararı (saf fonksiyon).
 *
 * Öncelik: 1) Barkod/GTIN  2) Üretici parça no (MPN) + marka  3) SKU
 *          4) Marka + model (isim benzerliği)  5) Admin
 *
 * Kural: yalnızca tek ve çelişkisiz bir GTIN ya da MPN+marka eşleşmesi otomatik
 * birleştirilir. Diğer her durum admin onayına düşer; asla tahminle birleştirilmez.
 */

export type MatchMethodCode = "GTIN" | "MPN" | "SUPPLIER_SKU" | "BRAND_MODEL" | "MANUAL";

export type MatchSignals = {
  gtinMatches: string[];
  mpnMatches: { variantId: string; brandMatches: boolean; gtinConflict: boolean }[];
  skuMatches: string[];
  fuzzy: { variantId: string; score: number }[];
};

export type MatchCandidate = { variantId: string; method: MatchMethodCode; score: number };

export type MatchDecision =
  | { kind: "AUTO"; variantId: string; method: MatchMethodCode; confidence: number }
  | { kind: "REVIEW"; candidates: MatchCandidate[] }
  | { kind: "NONE" };

export const FUZZY_THRESHOLD = 0.45;

export function decideMatch(s: MatchSignals): MatchDecision {
  const gtin = [...new Set(s.gtinMatches)];
  if (gtin.length === 1) return { kind: "AUTO", variantId: gtin[0], method: "GTIN", confidence: 1 };
  if (gtin.length > 1) {
    // Aynı barkod birden fazla varyantta: veri hatası, admin karar vermeli.
    return { kind: "REVIEW", candidates: gtin.map((variantId) => ({ variantId, method: "GTIN", score: 0.9 })) };
  }

  const candidates: MatchCandidate[] = [];

  const strongMpn = s.mpnMatches.filter((m) => m.brandMatches && !m.gtinConflict);
  if (strongMpn.length === 1 && s.mpnMatches.length === 1) {
    return { kind: "AUTO", variantId: strongMpn[0].variantId, method: "MPN", confidence: 0.95 };
  }
  for (const m of s.mpnMatches) candidates.push({ variantId: m.variantId, method: "MPN", score: m.brandMatches ? 0.8 : 0.6 });

  for (const variantId of s.skuMatches) candidates.push({ variantId, method: "SUPPLIER_SKU", score: 0.55 });

  for (const f of s.fuzzy) {
    if (f.score >= FUZZY_THRESHOLD) candidates.push({ variantId: f.variantId, method: "BRAND_MODEL", score: Math.min(0.79, f.score) });
  }

  if (candidates.length === 0) return { kind: "NONE" };

  // Aynı varyant için en güçlü sinyali tut, skora göre sırala, en fazla 5 öneri.
  const best = new Map<string, MatchCandidate>();
  for (const c of candidates) {
    const prev = best.get(c.variantId);
    if (!prev || c.score > prev.score) best.set(c.variantId, c);
  }
  return { kind: "REVIEW", candidates: [...best.values()].sort((a, b) => b.score - a.score).slice(0, 5) };
}

/** Marka adlarını karşılaştırma için normalize eder: "Aqua Shield" = "AquaShield". */
export function normalizeBrand(name: string | null | undefined): string {
  return (name ?? "")
    .toLocaleLowerCase("tr")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]/g, "");
}
