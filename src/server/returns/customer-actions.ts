"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { requireUser } from "../auth/dal";
import { planReturn, type ReturnPlanError } from "@/domain/returns/plan";

export type ReturnFormState = { ok?: boolean; message?: string };

const schema = z.object({
  orderId: z.string().min(1).max(40),
  reason: z.enum(["DAMAGED", "WRONG_ITEM", "NOT_AS_DESCRIBED", "CHANGED_MIND", "OTHER"]),
  note: z.string().trim().max(1000).optional(),
});

export const RETURN_REASONS: Record<z.infer<typeof schema>["reason"], string> = {
  DAMAGED: "Ürün hasarlı geldi",
  WRONG_ITEM: "Yanlış ürün gönderildi",
  NOT_AS_DESCRIBED: "Ürün açıklamadaki gibi değil",
  CHANGED_MIND: "Vazgeçtim",
  OTHER: "Diğer",
};

const ERRORS: Record<ReturnPlanError, string> = {
  EMPTY: "İade edilecek en az bir ürün seçin",
  UNKNOWN_ITEM: "Seçilen ürün bu siparişe ait değil",
  QTY_EXCEEDED: "İade adedi sipariş adedini aşıyor",
};

/**
 * Müşteri iade talebi. Siparişin kullanıcıya ait olduğu doğrulanır; kalemler
 * tedarikçi siparişine göre gruplanır ve her tedarikçi için ayrı Return kaydı
 * açılır — böylece iadenin hangi tedarikçiye ait olduğu her zaman bilinir.
 */
export async function requestReturnAction(_prev: ReturnFormState, formData: FormData): Promise<ReturnFormState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    orderId: formData.get("orderId"),
    reason: formData.get("reason"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { ok: false, message: "Lütfen iade nedenini seçin" };

  const requested = new Map<string, number>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty:")) continue;
    const qty = Number(value);
    if (Number.isInteger(qty) && qty > 0) requested.set(key.slice(4), qty);
  }

  const order = await db.order.findFirst({
    where: { id: parsed.data.orderId, userId: user.id, status: { in: ["SHIPPED", "PARTIALLY_SHIPPED", "DELIVERED"] } },
    select: {
      id: true,
      items: { select: { id: true, quantity: true, supplierOrderId: true } },
      returns: { where: { status: { notIn: ["REJECTED", "CANCELLED"] } }, select: { items: { select: { orderItemId: true, quantity: true } } } },
    },
  });
  if (!order) return { ok: false, message: "Bu sipariş için iade talebi oluşturulamaz" };

  const alreadyReturned = new Map<string, number>();
  for (const r of order.returns) for (const it of r.items) alreadyReturned.set(it.orderItemId, (alreadyReturned.get(it.orderItemId) ?? 0) + it.quantity);

  const plan = planReturn(order.items, alreadyReturned, requested);
  if (!plan.ok) return { ok: false, message: ERRORS[plan.error] };

  const created = await db.$transaction(
    plan.groups.map((group) =>
      db.return.create({
        data: {
          orderId: order.id,
          userId: user.id,
          supplierOrderId: group.supplierOrderId,
          reason: RETURN_REASONS[parsed.data.reason],
          customerNote: parsed.data.note,
          items: { create: group.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })) },
        },
        select: { id: true },
      }),
    ),
  );

  for (const r of created) {
    await audit({ action: "return.requested", actorType: "USER", actorId: user.id, entityType: "Return", entityId: r.id, metadata: { orderId: order.id } });
  }
  revalidatePath(`/account/orders/${order.id}`);
  return { ok: true, message: "İade talebin alındı. İnceleme sonrası bilgilendirileceksin." };
}
