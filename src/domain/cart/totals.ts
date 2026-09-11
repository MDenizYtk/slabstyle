import { shippingFee, type ShippingMethodId, type ShippingSettings, DEFAULT_SHIPPING_SETTINGS } from "../shipping/methods";

/**
 * Sepet toplamlarını hesaplar. Girdiler her zaman sunucuda veritabanından
 * okunan güncel fiyat ve stoktur; istemciden gelen fiyat asla kullanılmaz.
 * Fiyatlar KDV dahildir; taxTotal yalnızca bilgi amaçlı içindeki KDV'dir.
 */

export const MAX_QTY_PER_LINE = 20;
export const DEFAULT_TAX_RATE_BPS = 2000;

export type CartLineInput = {
  itemId: string;
  variantId: string;
  quantity: number;
  unitPrice: number | null;
  availableQty: number;
  isPurchasable: boolean;
};

export type CartLineIssue = "UNAVAILABLE" | "OUT_OF_STOCK" | "INSUFFICIENT_STOCK" | "NO_PRICE";

export type CartLineResult = CartLineInput & {
  lineTotal: number;
  issue: CartLineIssue | null;
  /** Stok yetersizse satın alınabilecek azami adet. */
  maxQty: number;
};

export type CartTotals = {
  lines: CartLineResult[];
  itemCount: number;
  subtotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  hasIssues: boolean;
};

export function includedTax(gross: number, rateBps = DEFAULT_TAX_RATE_BPS): number {
  return gross - Math.round((gross * 10_000) / (10_000 + rateBps));
}

export function evaluateLine(line: CartLineInput): CartLineResult {
  const maxQty = Math.min(MAX_QTY_PER_LINE, Math.max(0, line.availableQty));
  let issue: CartLineIssue | null = null;
  if (!line.isPurchasable) issue = "UNAVAILABLE";
  else if (line.unitPrice == null || line.unitPrice <= 0) issue = "NO_PRICE";
  else if (line.availableQty <= 0) issue = "OUT_OF_STOCK";
  else if (line.quantity > line.availableQty) issue = "INSUFFICIENT_STOCK";

  const lineTotal = issue ? 0 : (line.unitPrice ?? 0) * line.quantity;
  return { ...line, lineTotal, issue, maxQty };
}

export function computeCartTotals(
  inputs: readonly CartLineInput[],
  options: { shippingMethod?: ShippingMethodId; shippingSettings?: ShippingSettings } = {},
): CartTotals {
  const lines = inputs.map(evaluateLine);
  const valid = lines.filter((l) => !l.issue);
  const subtotal = valid.reduce((sum, l) => sum + l.lineTotal, 0);
  const itemCount = valid.reduce((sum, l) => sum + l.quantity, 0);
  const shippingTotal =
    subtotal === 0 ? 0 : shippingFee(subtotal, options.shippingMethod ?? "standard", options.shippingSettings ?? DEFAULT_SHIPPING_SETTINGS);
  const grandTotal = subtotal + shippingTotal;

  return {
    lines,
    itemCount,
    subtotal,
    shippingTotal,
    taxTotal: includedTax(grandTotal),
    grandTotal,
    hasIssues: lines.some((l) => l.issue),
  };
}

export const LINE_ISSUE_TEXT: Record<CartLineIssue, string> = {
  UNAVAILABLE: "Bu ürün artık satışta değil",
  OUT_OF_STOCK: "Stokta kalmadı",
  INSUFFICIENT_STOCK: "İstenen adet kadar stok yok",
  NO_PRICE: "Fiyat bilgisi güncelleniyor",
};
