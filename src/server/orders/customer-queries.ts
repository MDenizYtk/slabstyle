import "server-only";
import { db } from "../db";

/**
 * Müşterinin kendi siparişlerine erişimi. Her sorgu userId ile kısıtlanır:
 * başka bir kullanıcının sipariş id'si bilinse bile kayıt dönmez.
 * Tedarikçi adı, alış fiyatı ve maliyet alanları seçilmez.
 */

export async function getUserOrders(userId: string) {
  return db.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      status: true,
      grandTotal: true,
      createdAt: true,
      _count: { select: { items: true } },
    },
  });
}

export async function getUserOrder(userId: string, orderId: string) {
  return db.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true,
      number: true,
      status: true,
      email: true,
      shippingAddress: true,
      shippingMethod: true,
      subtotal: true,
      shippingTotal: true,
      discountTotal: true,
      taxTotal: true,
      grandTotal: true,
      createdAt: true,
      paidAt: true,
      payments: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      items: {
        where: { supplierOrderId: null },
        select: { id: true, productName: true, variantName: true, quantity: true, unitPrice: true, lineTotal: true },
      },
      supplierOrders: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          items: { select: { id: true, productName: true, variantName: true, quantity: true, unitPrice: true, lineTotal: true } },
          shipments: {
            select: { carrier: true, trackingNumber: true, trackingUrl: true, status: true, shippedAt: true, deliveredAt: true },
          },
        },
      },
      returns: {
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, reason: true, createdAt: true, items: { select: { orderItemId: true, quantity: true } } },
      },
    },
  });
}

export type UserOrderDetail = NonNullable<Awaited<ReturnType<typeof getUserOrder>>>;
