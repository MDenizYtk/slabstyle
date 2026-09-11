"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ReturnStatus } from "@/generated/prisma/client";
import { refundAmountForItems } from "@/domain/payments/refund";
import { db } from "../db";
import { audit } from "../audit";
import { requireAdmin, requireStaff } from "../auth/dal";
import { redirectWithFlash } from "../admin/flash";
import { createRefund, RefundError } from "../payments/refund";

const BACK = "/admin/returns";
const id = z.string().min(1).max(40);

/** İzin verilen iade durum geçişleri. */
const TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["RECEIVED", "REFUNDED", "CANCELLED"],
  RECEIVED: ["REFUNDED"],
  REJECTED: [],
  REFUNDED: [],
  CANCELLED: [],
};

async function transition(formData: FormData, to: ReturnStatus, action: string) {
  const user = await requireStaff();
  const returnId = id.parse(formData.get("returnId"));
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000) || undefined;
  const r = await db.return.findUniqueOrThrow({ where: { id: returnId }, select: { status: true } });
  if (!TRANSITIONS[r.status].includes(to)) redirectWithFlash(BACK, `${r.status} → ${to} geçişine izin yok`, "bad");
  await db.return.update({
    where: { id: returnId },
    data: { status: to, adminNote: note, resolvedAt: to === "REJECTED" || to === "CANCELLED" ? new Date() : undefined },
  });
  await audit({ action, actorType: "USER", actorId: user.id, entityType: "Return", entityId: returnId, metadata: { note: note ?? null } });
  revalidatePath(BACK);
}

export async function approveReturnAction(formData: FormData) {
  await transition(formData, "APPROVED", "return.approved");
  redirectWithFlash(BACK, "İade onaylandı. Müşteriye ürünü hangi tedarikçiye göndereceği bildirilmeli.");
}

export async function rejectReturnAction(formData: FormData) {
  await transition(formData, "REJECTED", "return.rejected");
  redirectWithFlash(BACK, "İade reddedildi");
}

export async function receivedReturnAction(formData: FormData) {
  await transition(formData, "RECEIVED", "return.received");
  redirectWithFlash(BACK, "Ürün teslim alındı olarak işaretlendi");
}

/** İade edilen kalemlerin tutarı kadar ücret iadesi yapar. */
export async function refundReturnAction(formData: FormData) {
  const user = await requireAdmin();
  const returnId = id.parse(formData.get("returnId"));
  const r = await db.return.findUniqueOrThrow({
    where: { id: returnId },
    select: { id: true, status: true, orderId: true, items: { select: { quantity: true, orderItem: { select: { unitPrice: true } } } } },
  });
  if (!TRANSITIONS[r.status].includes("REFUNDED")) redirectWithFlash(BACK, "Bu iade için ücret iadesi yapılamaz", "bad");

  const payment = await db.payment.findFirst({
    where: { orderId: r.orderId, status: { in: ["CAPTURED", "PARTIALLY_REFUNDED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!payment) redirectWithFlash(BACK, "Siparişin tahsil edilmiş ödemesi yok", "bad");

  const amount = refundAmountForItems(r.items.map((i) => ({ unitPrice: i.orderItem.unitPrice, quantity: i.quantity })));
  try {
    await createRefund(db, { paymentId: payment.id, amount, reason: "Ürün iadesi", idempotencyKey: `return:${r.id}`, returnId: r.id, actorId: user.id });
  } catch (error) {
    redirectWithFlash(BACK, error instanceof RefundError ? error.message : "İade başarısız", "bad");
  }
  await db.return.update({ where: { id: r.id }, data: { status: "REFUNDED", resolvedAt: new Date() } });
  await audit({ action: "return.refunded", actorType: "USER", actorId: user.id, entityType: "Return", entityId: r.id, metadata: { amount } });
  revalidatePath(BACK);
  redirectWithFlash(BACK, "Ücret iadesi yapıldı");
}
