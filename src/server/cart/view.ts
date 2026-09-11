import { computeCartTotals, type CartLineResult, type CartTotals } from "@/domain/cart/totals";
import { stockLabel } from "@/domain/inventory/stock";
import type { ShippingMethodId } from "@/domain/shipping/methods";
import { db } from "../db";
import { getShippingSettings } from "../settings";

/**
 * Sepetin sunucu tarafı görünümü: fiyat ve stok her seferinde veritabanından
 * okunur. Cookie'ye bağlı değildir; checkout servisi ve testler de kullanır.
 */

const LINE_SELECT = {
  id: true,
  quantity: true,
  variant: {
    select: {
      id: true,
      name: true,
      isActive: true,
      price: { select: { amount: true } },
      inventory: { select: { availableQty: true } },
      product: {
        select: {
          slug: true,
          name: true,
          status: true,
          images: { select: { url: true }, orderBy: { position: "asc" as const }, take: 1 },
        },
      },
    },
  },
} as const;

export type CartViewLine = CartLineResult & {
  productName: string;
  productSlug: string;
  variantName: string;
  imageUrl: string | null;
  stockLabel: string;
};

export type CartView = { cartId: string | null; lines: CartViewLine[]; totals: Omit<CartTotals, "lines"> };

export async function loadCartView(cartId: string | null, shippingMethod: ShippingMethodId = "standard"): Promise<CartView> {
  const items = cartId
    ? await db.cartItem.findMany({ where: { cartId }, orderBy: { createdAt: "asc" }, select: LINE_SELECT })
    : [];
  const shippingSettings = await getShippingSettings(db);

  const totals = computeCartTotals(
    items.map((item) => ({
      itemId: item.id,
      variantId: item.variant.id,
      quantity: item.quantity,
      unitPrice: item.variant.price?.amount ?? null,
      availableQty: item.variant.inventory?.availableQty ?? 0,
      isPurchasable: item.variant.isActive && item.variant.product.status === "ACTIVE",
    })),
    { shippingMethod, shippingSettings },
  );

  const lines = totals.lines.map((line, i) => {
    const item = items[i];
    return {
      ...line,
      productName: item.variant.product.name,
      productSlug: item.variant.product.slug,
      variantName: item.variant.name,
      imageUrl: item.variant.product.images[0]?.url ?? null,
      stockLabel: stockLabel(line.availableQty),
    };
  });

  const { lines: _lines, ...rest } = totals;
  return { cartId, lines, totals: rest };
}
