import { z } from "zod";
import type { NormalizedProduct, RowError, StockPriceUpdate } from "./types";

/**
 * Tedarikçi alan eşlemesi. Feed tabanlı tedarikçilerde kod yazmadan, yalnızca
 * admin panelinden girilen config ile "tedarikçinin alan adı → bizim alanımız"
 * eşlemesi yapılır. Değerler nokta ile iç içe yol olabilir: "fiyat.alis".
 */

export const fieldMapSchema = z.object({
  supplierSku: z.string().min(1),
  title: z.string().min(1),
  costPrice: z.string().min(1),
  stock: z.string().min(1),
  description: z.string().optional(),
  brand: z.string().optional(),
  gtin: z.string().optional(),
  mpn: z.string().optional(),
  categoryPath: z.string().optional(),
  images: z.string().optional(),
  leadTimeDays: z.string().optional(),
  isActive: z.string().optional(),
  currency: z.string().optional(),
});

export const priceFormatSchema = z.object({
  /** "1.250,90" için ",", "1250.90" için "." */
  decimalSeparator: z.enum([",", "."]).default("."),
  /** Feed'deki fiyat KDV hariçse KDV eklenir. */
  vatIncluded: z.boolean().default(true),
  vatRateBps: z.number().int().min(0).max(10_000).default(2000),
  /** Fiyat zaten kuruş cinsindense true. */
  inMinorUnits: z.boolean().default(false),
  currency: z.string().default("TRY"),
});

export type FieldMap = z.infer<typeof fieldMapSchema>;
export type PriceFormat = z.infer<typeof priceFormatSchema>;

export function getPath(record: unknown, path: string): unknown {
  let cur: unknown = record;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  // XML ayrıştırıcılar metin düğümlerini { "#text": ... } biçiminde verebilir.
  if (cur && typeof cur === "object" && !Array.isArray(cur) && "#text" in cur) return (cur as Record<string, unknown>)["#text"];
  return cur;
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

export function parseMoney(value: unknown, fmt: PriceFormat): number | null {
  const raw = str(value);
  if (raw == null) return null;
  if (!/\d/.test(raw)) return null;
  let cleaned = raw.replace(/[^\d.,-]/g, "");
  if (fmt.decimalSeparator === ",") cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  else cleaned = cleaned.replace(/,/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  let minor = fmt.inMinorUnits ? Math.round(n) : Math.round(n * 100);
  if (!fmt.vatIncluded) minor = Math.round((minor * (10_000 + fmt.vatRateBps)) / 10_000);
  return minor;
}

export function parseStock(value: unknown): number | null {
  const raw = str(value);
  if (raw == null) return null;
  // Bazı tedarikçiler "20+", "Var", "Yok" gibi değerler gönderir.
  if (/^(yok|none|false|out)$/i.test(raw)) return 0;
  const n = Number.parseInt(raw.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function parseBool(value: unknown): boolean | undefined {
  const raw = str(value);
  if (raw == null) return undefined;
  return !/^(0|false|hayir|hayır|no|pasif|passive)$/i.test(raw);
}

export function mapRecord(
  record: unknown,
  map: FieldMap,
  fmt: PriceFormat,
  row: number | string,
): { ok: true; product: NormalizedProduct } | { ok: false; error: RowError } {
  const supplierSku = str(getPath(record, map.supplierSku));
  const title = str(getPath(record, map.title));
  const costPrice = parseMoney(getPath(record, map.costPrice), fmt);
  const stock = parseStock(getPath(record, map.stock));

  if (!supplierSku) return { ok: false, error: { row, message: "SKU boş" } };
  if (!title) return { ok: false, error: { row: supplierSku, message: "Ürün adı boş" } };
  if (costPrice == null) return { ok: false, error: { row: supplierSku, message: "Geçersiz fiyat" } };
  if (stock == null) return { ok: false, error: { row: supplierSku, message: "Geçersiz stok" } };

  const imagesRaw = map.images ? getPath(record, map.images) : undefined;
  const imageUrls = (Array.isArray(imagesRaw) ? imagesRaw : str(imagesRaw)?.split(/[|;,\s]+/) ?? [])
    .map((u) => String(u).trim())
    .filter((u) => /^https?:\/\//.test(u))
    .slice(0, 12);

  return {
    ok: true,
    product: {
      supplierSku,
      title: title.slice(0, 500),
      description: map.description ? str(getPath(record, map.description)) : null,
      brand: map.brand ? str(getPath(record, map.brand)) : null,
      gtin: map.gtin ? str(getPath(record, map.gtin)) : null,
      mpn: map.mpn ? str(getPath(record, map.mpn)) : null,
      categoryPath: map.categoryPath ? str(getPath(record, map.categoryPath)) : null,
      imageUrls,
      costPrice,
      currency: (map.currency ? str(getPath(record, map.currency)) : null) ?? fmt.currency,
      stock,
      leadTimeDays: map.leadTimeDays ? parseStock(getPath(record, map.leadTimeDays)) : null,
      isActive: map.isActive ? parseBool(getPath(record, map.isActive)) : undefined,
      raw: record,
    },
  };
}

export function toStockUpdate(p: NormalizedProduct): StockPriceUpdate {
  return { supplierSku: p.supplierSku, stock: p.stock, costPrice: p.costPrice, isActive: p.isActive };
}
