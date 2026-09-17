import "server-only";
import { PAID_ORDER_STATUSES } from "@/domain/orders/status";
import { db } from "../db";
import { getContactSettings } from "../settings";

/** Vitrin modu özeti: ürün ve fotoğraf odaklı. */
export async function getShowcaseStats() {
  const [activeProducts, draftProducts, withoutImage, categories, contact, recentProducts] = await Promise.all([
    db.product.count({ where: { status: "ACTIVE" } }),
    db.product.count({ where: { status: "DRAFT" } }),
    db.product.count({ where: { status: { not: "ARCHIVED" }, images: { none: {} } } }),
    db.category.count(),
    getContactSettings(db),
    db.product.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, name: true, status: true, minPrice: true, category: { select: { name: true } }, images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 } },
    }),
  ]);
  return {
    activeProducts,
    draftProducts,
    withoutImage,
    categories,
    hasContact: Boolean(contact.whatsapp || contact.phone || contact.email),
    recentProducts,
  };
}

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
    awaitingTransfer,
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
    db.order.count({ where: { status: "PENDING_PAYMENT", payments: { some: { provider: "bank_transfer", status: "PENDING" } } } }),
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
    awaitingTransfer,
  };
}
