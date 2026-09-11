import "server-only";
import { cookies } from "next/headers";
import { MAX_QTY_PER_LINE } from "@/domain/cart/totals";
import type { ShippingMethodId } from "@/domain/shipping/methods";
import { db } from "../db";
import { getCurrentUser } from "../auth/dal";
import { randomToken, sha256Hex } from "../security/crypto";
import { loadCartView, type CartView } from "./view";

export { loadCartView, type CartView, type CartViewLine } from "./view";

export const CART_COOKIE = "ss_cart";

export class CartError extends Error {}

type CartRef = { id: string } | null;

/**
 * Aktif sepeti bulur. Giriş yapmış kullanıcıda kullanıcıya bağlı sepet, misafirde
 * cookie token'ının hash'i ile bulunan sepet kullanılır. `create` yalnızca server
 * action'lardan true verilmelidir (cookie yazımı gerekir).
 */
async function findCart(create: boolean): Promise<CartRef> {
  const user = await getCurrentUser();
  if (user) {
    const existing = await db.cart.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (existing || !create) return existing;
    return db.cart.create({ data: { userId: user.id }, select: { id: true } });
  }

  const store = await cookies();
  const token = store.get(CART_COOKIE)?.value;
  if (token) {
    const existing = await db.cart.findFirst({ where: { guestToken: sha256Hex(token), status: "ACTIVE" }, select: { id: true } });
    if (existing) return existing;
  }
  if (!create) return null;

  const fresh = randomToken(24);
  store.set(CART_COOKIE, fresh, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return db.cart.create({ data: { guestToken: sha256Hex(fresh) }, select: { id: true } });
}

export async function getCartView(shippingMethod: ShippingMethodId = "standard"): Promise<CartView> {
  const cart = await findCart(false);
  return loadCartView(cart?.id ?? null, shippingMethod);
}

export async function getCartCount(): Promise<number> {
  const cart = await findCart(false);
  if (!cart) return 0;
  const agg = await db.cartItem.aggregate({ where: { cartId: cart.id }, _sum: { quantity: true } });
  return agg._sum.quantity ?? 0;
}

export async function addItem(variantId: string, quantity: number): Promise<void> {
  const variant = await db.productVariant.findFirst({
    where: { id: variantId, isActive: true, product: { status: "ACTIVE" } },
    select: { id: true, inventory: { select: { availableQty: true } }, price: { select: { amount: true } } },
  });
  if (!variant || !variant.price) throw new CartError("Ürün satışta değil");
  const available = variant.inventory?.availableQty ?? 0;
  if (available <= 0) throw new CartError("Ürün stokta yok");

  const cart = await findCart(true);
  if (!cart) throw new CartError("Sepet oluşturulamadı");

  const existing = await db.cartItem.findUnique({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    select: { quantity: true },
  });
  const desired = (existing?.quantity ?? 0) + quantity;
  const finalQty = Math.min(desired, MAX_QTY_PER_LINE, available);

  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    create: { cartId: cart.id, variantId, quantity: finalQty },
    update: { quantity: finalQty },
  });
  await db.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });

  if (finalQty < desired) throw new CartError(`Stok nedeniyle sepetinizde en fazla ${finalQty} adet olabilir`);
}

export async function setItemQuantity(itemId: string, quantity: number): Promise<void> {
  const cart = await findCart(false);
  if (!cart) throw new CartError("Sepet bulunamadı");
  // cartId koşulu, başka birinin sepet satırının değiştirilmesini engeller.
  if (quantity <= 0) {
    await db.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
    return;
  }
  const result = await db.cartItem.updateMany({
    where: { id: itemId, cartId: cart.id },
    data: { quantity: Math.min(quantity, MAX_QTY_PER_LINE) },
  });
  if (result.count === 0) throw new CartError("Sepet satırı bulunamadı");
}

export async function removeItem(itemId: string): Promise<void> {
  const cart = await findCart(false);
  if (!cart) return;
  await db.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
}

/** Girişte misafir sepetini kullanıcının sepetine taşır. */
export async function mergeGuestCartIntoUser(userId: string): Promise<void> {
  const store = await cookies();
  const token = store.get(CART_COOKIE)?.value;
  if (!token) return;

  const guest = await db.cart.findFirst({
    where: { guestToken: sha256Hex(token), status: "ACTIVE" },
    select: { id: true, items: { select: { variantId: true, quantity: true } } },
  });
  store.delete(CART_COOKIE);
  if (!guest) return;

  await db.$transaction(async (tx) => {
    const userCart =
      (await tx.cart.findFirst({ where: { userId, status: "ACTIVE" }, select: { id: true } })) ??
      (await tx.cart.create({ data: { userId }, select: { id: true } }));

    for (const item of guest.items) {
      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
        select: { quantity: true },
      });
      const qty = Math.min(MAX_QTY_PER_LINE, (existing?.quantity ?? 0) + item.quantity);
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
        create: { cartId: userCart.id, variantId: item.variantId, quantity: qty },
        update: { quantity: qty },
      });
    }
    await tx.cart.update({ where: { id: guest.id }, data: { status: "CONVERTED", guestToken: null } });
  });
}

export async function getActiveCartId(): Promise<string | null> {
  return (await findCart(false))?.id ?? null;
}
