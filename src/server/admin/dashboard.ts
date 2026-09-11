import "server-only";
import { PAID_ORDER_STATUSES } from "@/domain/orders/status";
import { db } from "../db";

export async function getDashboardStats() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const paid = { status: { in: [...PAID_ORDER_STATUSES] } };

  const [
    sales,
    orderCount,
    pendingOrders,
    productCount,
    supplierCount,
    outOfStock,
    failedSyncs,
    unmatched,
    pendingReview,
    supplierOrdersAttention,
    openReturns,
    recentOrders,
    recentSyncs,
  ] = await Promise.all([
    db.order.aggregate({ where: paid, _sum: { grandTotal: true, subtotal: true, costTotal: true } }),
    db.order.count(),
    db.order.count({ where: { status: { in: ["PAID", "PROCESSING"] } } }),
    db.product.count({ where: { status: "ACTIVE" } }),
    db.supplier.count({ where: { status: { not: "DISABLED" } } }),
    db.product.count({ where: { status: "ACTIVE", totalAvailable: 0 } }),
    db.syncJob.count({ where: { status: "FAILED", queuedAt: { gte: since24h } } }),
    db.supplierProduct.count({ where: { matchStatus: "UNMATCHED", status: "ACTIVE" } }),
    db.supplierProduct.count({ where: { matchStatus: "PENDING_REVIEW" } }),
    db.supplierOrder.count({ where: { status: { in: ["AWAITING_MANUAL", "FAILED", "REJECTED"] } } }),
    db.return.count({ where: { status: { in: ["REQUESTED", "APPROVED", "RECEIVED"] } } }),
    db.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, number: true, status: true, grandTotal: true, createdAt: true, user: { select: { name: true } } },
    }),
    db.syncJob.findMany({
      orderBy: { queuedAt: "desc" },
      take: 8,
      select: { id: true, type: true, status: true, queuedAt: true, errorMessage: true, supplier: { select: { name: true } } },
    }),
  ]);

  const revenue = sales._sum.grandTotal ?? 0;
  // Tahmini kâr: ürün satış tutarı - tedarikçi maliyeti (kargo ve ödeme komisyonu hariç).
  const estimatedProfit = (sales._sum.subtotal ?? 0) - (sales._sum.costTotal ?? 0);

  return {
    revenue,
    estimatedProfit,
    orderCount,
    pendingOrders,
    productCount,
    supplierCount,
    outOfStock,
    failedSyncs,
    unmatched,
    pendingReview,
    supplierOrdersAttention,
    openReturns,
    recentOrders,
    recentSyncs,
  };
}
