/**
 * Sipariş durum geçişleri (saf fonksiyonlar). Ana sipariş durumu, alt tedarikçi
 * siparişlerinin durumlarından türetilir.
 */

export type OrderStatusCode =
  | "PENDING_PAYMENT"
  | "PAID"
  | "PROCESSING"
  | "PARTIALLY_SHIPPED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export type SupplierOrderStatusCode =
  | "PENDING"
  | "AWAITING_MANUAL"
  | "SUBMITTING"
  | "SUBMITTED"
  | "ACCEPTED"
  | "REJECTED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED";

const TERMINAL_OR_PREPAID: OrderStatusCode[] = ["PENDING_PAYMENT", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"];

export function deriveOrderStatus(
  current: OrderStatusCode,
  supplierStatuses: readonly SupplierOrderStatusCode[],
  hasUnallocated = false,
): OrderStatusCode {
  if (TERMINAL_OR_PREPAID.includes(current)) return current;
  const active = supplierStatuses.filter((s) => s !== "CANCELLED");
  if (active.length === 0) return current === "PAID" ? "PAID" : current;

  const shipped = active.filter((s) => s === "SHIPPED" || s === "DELIVERED");
  if (!hasUnallocated && active.every((s) => s === "DELIVERED")) return "DELIVERED";
  if (!hasUnallocated && shipped.length === active.length) return "SHIPPED";
  if (shipped.length > 0) return "PARTIALLY_SHIPPED";
  return "PROCESSING";
}

export type ExternalOrderStatusCode = "RECEIVED" | "ACCEPTED" | "REJECTED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "UNKNOWN";

export function mapExternalStatus(status: ExternalOrderStatusCode): SupplierOrderStatusCode | null {
  switch (status) {
    case "RECEIVED":
      return "SUBMITTED";
    case "UNKNOWN":
      return null;
    default:
      return status;
  }
}

const RANK: Record<SupplierOrderStatusCode, number> = {
  PENDING: 0, AWAITING_MANUAL: 0, FAILED: 0, SUBMITTING: 1, SUBMITTED: 2, ACCEPTED: 3, SHIPPED: 4, DELIVERED: 5, REJECTED: 9, CANCELLED: 9,
};

/** Durum yalnızca ileri gider; geç gelen eski bir bilgi siparişi geri almaz. */
export function advanceSupplierStatus(current: SupplierOrderStatusCode, next: SupplierOrderStatusCode): SupplierOrderStatusCode {
  if (current === "CANCELLED" || current === "REJECTED") return current;
  if (next === "CANCELLED" || next === "REJECTED") return next;
  return RANK[next] > RANK[current] ? next : current;
}

/** Kargo kayıtlarından tedarikçi siparişinin durumu. */
export function statusFromShipments(statuses: readonly string[]): "SHIPPED" | "DELIVERED" | null {
  if (statuses.length === 0) return null;
  return statuses.every((s) => s === "DELIVERED") ? "DELIVERED" : "SHIPPED";
}
