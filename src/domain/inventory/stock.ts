/**
 * Stok hesapları. Tedarikçinin bildirdiği stok ile müşteriye gösterilen stok
 * arasına safety stock tamponu konur; böylece senkronizasyon aralığında
 * tükenmiş ürün satılma riski azalır.
 */

export type StockOffer = {
  stock: number;
  safetyStock: number;
  /** Tedarikçi ve tedarikçi ürünü aktif mi? */
  isAvailable: boolean;
};

export function sellableQty(stock: number, safetyStock: number): number {
  if (!Number.isFinite(stock) || stock <= 0) return 0;
  return Math.max(0, Math.floor(stock) - Math.max(0, Math.floor(safetyStock)));
}

export type AggregatedStock = {
  /** Müşteriye satılabilir toplam adet. */
  availableQty: number;
  /** Tedarikçilerin bildirdiği ham toplam (yalnızca admin). */
  supplierQty: number;
};

export function aggregateStock(offers: readonly StockOffer[]): AggregatedStock {
  let availableQty = 0;
  let supplierQty = 0;
  for (const offer of offers) {
    if (!offer.isAvailable) continue;
    supplierQty += Math.max(0, offer.stock);
    availableQty += sellableQty(offer.stock, offer.safetyStock);
  }
  return { availableQty, supplierQty };
}

export type StockLevel = "OUT_OF_STOCK" | "LOW" | "IN_STOCK";

export function stockLevel(availableQty: number, lowThreshold = 5): StockLevel {
  if (availableQty <= 0) return "OUT_OF_STOCK";
  if (availableQty <= lowThreshold) return "LOW";
  return "IN_STOCK";
}

/** Müşteri tarafında tam adet yerine gösterilecek güvenli etiket. */
export function stockLabel(availableQty: number): string {
  switch (stockLevel(availableQty)) {
    case "OUT_OF_STOCK":
      return "Tükendi";
    case "LOW":
      return `Son ${availableQty} ürün`;
    case "IN_STOCK":
      return "Stokta";
  }
}
