/**
 * İade talebini doğrular ve tedarikçi siparişine göre gruplar (saf fonksiyon).
 */

export type ReturnableItem = { id: string; quantity: number; supplierOrderId: string | null };
export type ReturnPlanError = "EMPTY" | "UNKNOWN_ITEM" | "QTY_EXCEEDED";
export type ReturnGroup = { supplierOrderId: string | null; items: { orderItemId: string; quantity: number }[] };

export function planReturn(
  orderItems: readonly ReturnableItem[],
  alreadyReturned: ReadonlyMap<string, number>,
  requested: ReadonlyMap<string, number>,
): { ok: true; groups: ReturnGroup[] } | { ok: false; error: ReturnPlanError } {
  if (requested.size === 0) return { ok: false, error: "EMPTY" };
  const byId = new Map(orderItems.map((i) => [i.id, i]));
  const groups = new Map<string, ReturnGroup>();

  for (const [itemId, qty] of requested) {
    const item = byId.get(itemId);
    if (!item) return { ok: false, error: "UNKNOWN_ITEM" };
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: "EMPTY" };
    if (qty + (alreadyReturned.get(itemId) ?? 0) > item.quantity) return { ok: false, error: "QTY_EXCEEDED" };
    const key = item.supplierOrderId ?? "none";
    const group = groups.get(key) ?? { supplierOrderId: item.supplierOrderId, items: [] };
    group.items.push({ orderItemId: itemId, quantity: qty });
    groups.set(key, group);
  }
  return { ok: true, groups: [...groups.values()] };
}
