/**
 * Senkronizasyon güvenlik kuralları. Amaç: tedarikçi tarafındaki geçici bir
 * hata (boş feed, yarım dosya, yanlış fiyat) mevcut doğru veriyi bozmasın.
 */

export const MAX_REMOVAL_RATIO = 0.3;
export const MAX_PRICE_CHANGE_BPS = 7000;

export type RemovalDecision = { apply: true } | { apply: false; reason: string };

/**
 * Katalogda artık görünmeyen ürünler kaldırılsın mı?
 * - Hiç ürün gelmediyse: feed büyük ihtimalle bozuk, kaldırma.
 * - Aktif ürünlerin çok büyük kısmı kayboluyorsa: yarım feed şüphesi, kaldırma.
 */
export function decideRemoval(totalActive: number, missing: number, fetched: number, maxRatio = MAX_REMOVAL_RATIO): RemovalDecision {
  if (missing === 0) return { apply: true };
  if (fetched === 0) return { apply: false, reason: "Tedarikçiden hiç ürün gelmedi; mevcut ürünler korunuyor" };
  const ratio = totalActive === 0 ? 0 : missing / totalActive;
  if (ratio > maxRatio) {
    return {
      apply: false,
      reason: `Ürünlerin %${Math.round(ratio * 100)}'i feed'de yok (sınır %${Math.round(maxRatio * 100)}); güvenlik nedeniyle kaldırılmadı`,
    };
  }
  return { apply: true };
}

/** Maliyette ani ve büyük değişim (ör. 480 TL → 4,80 TL) veri hatası olabilir. */
export function isSuspiciousPriceChange(oldCost: number, newCost: number, maxBps = MAX_PRICE_CHANGE_BPS): boolean {
  if (oldCost <= 0 || newCost <= 0) return newCost <= 0 && oldCost > 0;
  return Math.abs(newCost - oldCost) * 10_000 > oldCost * maxBps;
}

/** Senkronizasyon zamanı geldi mi? */
export function isDue(lastAt: Date | null, intervalMin: number, now = new Date()): boolean {
  if (!lastAt) return true;
  return now.getTime() - lastAt.getTime() >= intervalMin * 60_000;
}
