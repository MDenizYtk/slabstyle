import type { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "../db";

/**
 * Checkout'ta ayrılan stoğun serbest bırakılması. Her sipariş satırı yalnızca bir
 * kez serbest bırakılır (reservationReleased bayrağı ile atomik sahiplenme).
 *
 * - "consumed": sipariş tedarikçiye iletildi. Rezerv düşer ama satılabilir stok
 *   ARTMAZ; tedarikçinin stoğu bir sonraki senkronizasyonda zaten azalmış gelir.
 * - "cancelled": sipariş iptal/ödeme süresi doldu. Adet satışa geri döner.
 */
export async function releaseReservations(
  db: DbClient,
  where: Prisma.OrderItemWhereInput,
  mode: "consumed" | "cancelled",
): Promise<number> {
  const items = await db.orderItem.findMany({
    where: { ...where, reservationReleased: false, variantId: { not: null } },
    select: { id: true, variantId: true, quantity: true },
  });
  let released = 0;
  for (const item of items) {
    const claimed = await db.orderItem.updateMany({ where: { id: item.id, reservationReleased: false }, data: { reservationReleased: true } });
    if (claimed.count === 0) continue;
    released++;
    if (mode === "cancelled") {
      await db.$executeRaw`
        UPDATE "Inventory"
        SET "reservedQty" = GREATEST(0, "reservedQty" - ${item.quantity}), "availableQty" = "availableQty" + ${item.quantity}, "updatedAt" = now()
        WHERE "variantId" = ${item.variantId}`;
    } else {
      await db.$executeRaw`
        UPDATE "Inventory" SET "reservedQty" = GREATEST(0, "reservedQty" - ${item.quantity}), "updatedAt" = now()
        WHERE "variantId" = ${item.variantId}`;
    }
  }
  return released;
}
