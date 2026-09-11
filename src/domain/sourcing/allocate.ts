import { sellableQty } from "../inventory/stock";
import { rankOffers, selectBestOffer, type SelectionStrategy, type SupplierOffer } from "./select-offer";

/**
 * Sipariş satırını tedarikçilere dağıtır. Önce tüm adedi tek başına karşılayan
 * en iyi tedarikçi aranır (tek paket, tek kargo). Yoksa sıralamaya göre birden
 * fazla tedarikçiye bölünür. Hiçbir tedarikçinin karşılayamadığı kısım
 * "unallocated" döner ve admin müdahalesine bırakılır.
 */

export type Allocation = { offer: SupplierOffer; quantity: number };

export function allocateQuantity(
  offers: readonly SupplierOffer[],
  quantity: number,
  strategy: SelectionStrategy = "LOWEST_COST",
): { allocations: Allocation[]; unallocated: number } {
  if (quantity <= 0) return { allocations: [], unallocated: 0 };

  const single = selectBestOffer(offers, { quantity, strategy });
  if (single) return { allocations: [{ offer: single, quantity }], unallocated: 0 };

  const allocations: Allocation[] = [];
  let remaining = quantity;
  for (const offer of rankOffers(offers.filter((o) => o.isAvailable), strategy)) {
    const take = Math.min(remaining, sellableQty(offer.stock, offer.safetyStock));
    if (take <= 0) continue;
    allocations.push({ offer, quantity: take });
    remaining -= take;
    if (remaining === 0) break;
  }
  return { allocations, unallocated: remaining };
}
