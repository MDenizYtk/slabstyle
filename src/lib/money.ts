/**
 * Para değerleri sistemin her yerinde kuruş cinsinden tam sayıdır.
 * Kayan nokta hatalarını önlemek için hesaplamalar yalnızca tam sayılarla yapılır.
 */

const formatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
});

export function formatMoney(minor: number): string {
  return formatter.format(minor / 100);
}

/** 1250.9 → 125090 */
export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Admin formlarındaki TL girişini kuruşa çevirir: "1.250,90", "1250.90", "1250" kabul edilir.
 * Boş giriş null, geçersiz giriş NaN döner (çağıran doğrular).
 */
export function parseTlInput(value: unknown): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (raw === "") return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * 100);
}

export function formatBps(bps: number): string {
  return `%${(bps / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

/** Tam sayı üzerinde yüzde (baz puan) uygular, yukarı yuvarlar. 2500 bps = %25. */
export function applyBps(minor: number, bps: number): number {
  return Math.ceil((minor * bps) / 10_000);
}
