import { sellableQty } from "../inventory/stock";

/**
 * Bir varyant için en uygun tedarikçi teklifini seçer. Strateji değiştirilebilir
 * olacak şekilde tasarlandı; ileride ağırlıklı skorlama (fiyat + süre + öncelik +
 * tedarikçi performansı) buraya eklenecek.
 */

export type SupplierOffer = {
  supplierProductId: string;
  supplierId: string;
  cost: number;
  stock: number;
  safetyStock: number;
  leadTimeDays: number;
  supplierPriority: number;
  isAvailable: boolean;
};

export type SelectionStrategy = "LOWEST_COST" | "FASTEST" | "PRIORITY";

type Comparator = (a: SupplierOffer, b: SupplierOffer) => number;

const byCost: Comparator = (a, b) => a.cost - b.cost;
const byLead: Comparator = (a, b) => a.leadTimeDays - b.leadTimeDays;
const byPriority: Comparator = (a, b) => b.supplierPriority - a.supplierPriority;
const byId: Comparator = (a, b) => a.supplierProductId.localeCompare(b.supplierProductId);

const STRATEGIES: Record<SelectionStrategy, Comparator[]> = {
  LOWEST_COST: [byCost, byPriority, byLead, byId],
  FASTEST: [byLead, byCost, byPriority, byId],
  PRIORITY: [byPriority, byCost, byLead, byId],
};

export function rankOffers(offers: readonly SupplierOffer[], strategy: SelectionStrategy = "LOWEST_COST"): SupplierOffer[] {
  const comparators = STRATEGIES[strategy];
  return [...offers].sort((a, b) => {
    for (const cmp of comparators) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  });
}

/**
 * İstenen adedi tek başına karşılayabilen en iyi teklif. Hiçbiri karşılayamıyorsa null.
 */
export function selectBestOffer(
  offers: readonly SupplierOffer[],
  options: { quantity?: number; strategy?: SelectionStrategy } = {},
): SupplierOffer | null {
  const quantity = options.quantity ?? 1;
  const eligible = offers.filter((o) => o.isAvailable && sellableQty(o.stock, o.safetyStock) >= quantity);
  return rankOffers(eligible, options.strategy)[0] ?? null;
}
