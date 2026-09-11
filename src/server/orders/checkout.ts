import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { SHIPPING_METHOD_IDS, type ShippingMethodId } from "@/domain/shipping/methods";
import type { DbClient } from "../db";
import { audit } from "../audit";
import { loadCartView } from "../cart/view";
import { refreshProductAggregates } from "../catalog/recalculate";

/**
 * Sipariş oluşturma. Fiyat ve stok istemciden alınmaz; sepet sunucuda yeniden
 * hesaplanır, stok tek bir transaction içinde koşullu olarak ayrılır. Aynı
 * idempotencyKey ile ikinci gönderim yeni sipariş açmaz.
 *
 * Sipariş PENDING_PAYMENT durumunda açılır; "PAID" yalnızca doğrulanmış ödeme
 * webhook'u ile olur (bkz. payments/service.ts).
 */

export class CheckoutError extends Error {}

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^(\+90|0)?5\d{9}$/, "Geçerli bir cep telefonu girin (05xx xxx xx xx)"));

export const addressInputSchema = z.object({
  title: z.string().trim().max(40).default("Adres"),
  fullName: z.string().trim().min(3, "Ad soyad gerekli").max(100),
  phone,
  line1: z.string().trim().min(5, "Adres gerekli").max(250),
  line2: z.string().trim().max(250).optional(),
  district: z.string().trim().min(2, "İlçe gerekli").max(60),
  city: z.string().trim().min(2, "İl gerekli").max(60),
  postalCode: z.string().trim().max(10).optional(),
});

export type AddressInput = z.infer<typeof addressInputSchema>;

export type PlaceOrderInput = {
  userId: string;
  email: string;
  cartId: string;
  address: AddressInput;
  saveAddress: boolean;
  shippingMethod: ShippingMethodId;
  idempotencyKey: string;
  note?: string;
};

export async function placeOrder(db: DbClient, input: PlaceOrderInput): Promise<{ orderId: string; created: boolean }> {
  if (!SHIPPING_METHOD_IDS.includes(input.shippingMethod)) throw new CheckoutError("Geçersiz kargo yöntemi");

  const existing = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, userId: true } });
  if (existing) {
    if (existing.userId !== input.userId) throw new CheckoutError("Geçersiz istek");
    return { orderId: existing.id, created: false };
  }

  const cart = await db.cart.findFirst({ where: { id: input.cartId, userId: input.userId, status: "ACTIVE" }, select: { id: true } });
  if (!cart) throw new CheckoutError("Sepet bulunamadı");

  const view = await loadCartView(cart.id, input.shippingMethod);
  if (view.lines.length === 0) throw new CheckoutError("Sepetiniz boş");
  if (view.totals.hasIssues) throw new CheckoutError("Sepetinizde fiyatı veya stoğu değişen ürünler var. Lütfen sepetinizi kontrol edin.");

  const variants = await db.productVariant.findMany({
    where: { id: { in: view.lines.map((l) => l.variantId) } },
    select: { id: true, sku: true, productId: true, price: { select: { costAmount: true, supplierProductId: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  const items = view.lines.map((l) => {
    const v = byId.get(l.variantId)!;
    return {
      variantId: l.variantId,
      productName: l.productName,
      variantName: l.variantName,
      sku: v.sku,
      quantity: l.quantity,
      unitPrice: l.unitPrice!,
      // Tahmini maliyet; kesin maliyet ödeme sonrası tedarikçi seçiminde yazılır.
      unitCost: v.price?.costAmount ?? 0,
      supplierProductId: v.price?.supplierProductId ?? null,
      lineTotal: l.lineTotal,
    };
  });
  const address = { ...input.address, country: "TR" };

  let orderId: string;
  try {
    orderId = await db.$transaction(async (tx) => {
      for (const item of items) {
        const reserved = await tx.$executeRaw`
          UPDATE "Inventory"
          SET "reservedQty" = "reservedQty" + ${item.quantity}, "availableQty" = "availableQty" - ${item.quantity}, "updatedAt" = now()
          WHERE "variantId" = ${item.variantId} AND "availableQty" >= ${item.quantity}`;
        if (reserved !== 1) throw new CheckoutError(`"${item.productName}" için stok az önce değişti. Lütfen sepetinizi kontrol edin.`);
      }

      const order = await tx.order.create({
        data: {
          userId: input.userId,
          email: input.email,
          status: "PENDING_PAYMENT",
          shippingAddress: address,
          billingAddress: address,
          shippingMethod: input.shippingMethod,
          subtotal: view.totals.subtotal,
          shippingTotal: view.totals.shippingTotal,
          taxTotal: view.totals.taxTotal,
          grandTotal: view.totals.grandTotal,
          costTotal: items.reduce((s, i) => s + i.unitCost * i.quantity, 0),
          idempotencyKey: input.idempotencyKey,
          customerNote: input.note || null,
          items: { create: items },
        },
        select: { id: true },
      });

      await tx.cart.update({ where: { id: cart.id }, data: { status: "CONVERTED" } });
      if (input.saveAddress) {
        const hasDefault = await tx.address.count({ where: { userId: input.userId, isDefault: true } });
        await tx.address.create({ data: { ...input.address, userId: input.userId, isDefault: hasDefault === 0 } });
      }
      return order.id;
    });
  } catch (error) {
    // Aynı anda iki gönderim: ikincisi benzersizlik kısıtına takılır, ilk sipariş döner.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
      if (again) return { orderId: again.id, created: false };
    }
    throw error;
  }

  await refreshProductAggregates(db, [...new Set(variants.map((v) => v.productId))]);
  await audit({
    action: "order.created",
    actorType: "USER",
    actorId: input.userId,
    entityType: "Order",
    entityId: orderId,
    metadata: { grandTotal: view.totals.grandTotal, items: items.length },
  });
  return { orderId, created: true };
}
