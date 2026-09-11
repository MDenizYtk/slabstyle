"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { requireAdmin, requireStaff } from "../auth/dal";
import { redirectWithFlash } from "../admin/flash";
import { createRefund, RefundError } from "../payments/refund";
import { applyTracking, markSubmittedManually } from "./dispatch";
import { scheduleOrderJob } from "./jobs";
import { releaseReservations } from "./reservations";

const id = z.string().min(1).max(40);
const back = (orderId: string) => `/admin/orders/${orderId}`;

async function orderIdOf(supplierOrderId: string) {
  return (await db.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrderId }, select: { orderId: true } })).orderId;
}

export async function retrySubmitAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const soId = id.parse(formData.get("supplierOrderId"));
  const orderId = await orderIdOf(soId);
  await db.supplierOrder.updateMany({ where: { id: soId, status: { in: ["AWAITING_MANUAL", "PENDING"] } }, data: { status: "PENDING", dispatchMode: "AUTO" } });
  await scheduleOrderJob(db, { kind: "submit", supplierOrderId: soId });
  await audit({ action: "supplier_order.retry", actorType: "USER", actorId: user.id, entityType: "SupplierOrder", entityId: soId });
  revalidatePath(back(orderId));
  redirectWithFlash(back(orderId), "Tedarikçiye gönderim başlatıldı");
}

export async function markManualSubmittedAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const soId = id.parse(formData.get("supplierOrderId"));
  const externalOrderId = String(formData.get("externalOrderId") ?? "").trim().slice(0, 100);
  const orderId = await orderIdOf(soId);
  const ok = await markSubmittedManually(db, soId, externalOrderId, user.id);
  redirectWithFlash(back(orderId), ok ? "Tedarikçiye iletildi olarak işaretlendi" : "Bu tedarikçi siparişi zaten iletilmiş", ok ? "ok" : "bad");
}

const shipmentSchema = z.object({
  supplierOrderId: id,
  carrier: z.string().trim().min(2).max(60),
  trackingNumber: z.string().trim().min(3).max(80),
  trackingUrl: z.union([z.literal(""), z.url().refine((u) => u.startsWith("https://"), "https olmalı")]).optional(),
  status: z.enum(["LABEL_CREATED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "EXCEPTION"]),
});

export async function addShipmentAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const parsed = shipmentSchema.safeParse(Object.fromEntries(formData));
  const soId = String(formData.get("supplierOrderId") ?? "");
  const orderId = await orderIdOf(soId);
  if (!parsed.success) redirectWithFlash(back(orderId), parsed.error.issues[0]?.message ?? "Kargo bilgisi geçersiz", "bad");
  const d = parsed.data;
  await applyTracking(db, d.supplierOrderId, [{ carrier: d.carrier, trackingNumber: d.trackingNumber, trackingUrl: d.trackingUrl || null, status: d.status }], { type: "USER", id: user.id });
  redirectWithFlash(back(orderId), "Kargo bilgisi kaydedildi; müşteri sipariş ekranında görecek");
}

export async function pollNowAction(formData: FormData): Promise<void> {
  await requireStaff();
  const soId = id.parse(formData.get("supplierOrderId"));
  const orderId = await orderIdOf(soId);
  await scheduleOrderJob(db, { kind: "poll", supplierOrderId: soId });
  redirectWithFlash(back(orderId), "Tedarikçiden durum sorgulandı");
}

export async function reallocateAction(formData: FormData): Promise<void> {
  await requireStaff();
  const orderId = id.parse(formData.get("orderId"));
  await scheduleOrderJob(db, { kind: "allocate", orderId });
  redirectWithFlash(back(orderId), "Tedarikçi ataması yeniden denendi");
}

/**
 * Sipariş iptali + tam iade. Kargoya verilmiş paket varsa iptal edilemez
 * (iade süreci kullanılmalı). Tedarikçiye iletilmiş alt siparişlerin tedarikçi
 * tarafında da iptal edilmesi gerekir; admin bu konuda uyarılır.
 */
export async function cancelOrderAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const orderId = id.parse(formData.get("orderId"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300) || "Admin tarafından iptal";

  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      status: true,
      supplierOrders: { select: { id: true, status: true, externalOrderId: true } },
      payments: { where: { status: { in: ["CAPTURED", "PARTIALLY_REFUNDED"] } }, select: { id: true, amount: true, refunds: { where: { status: "SUCCEEDED" }, select: { amount: true } } } },
    },
  });
  if (["CANCELLED", "REFUNDED"].includes(order.status)) redirectWithFlash(back(orderId), "Sipariş zaten iptal/iade edilmiş", "bad");
  if (order.supplierOrders.some((s) => s.status === "SHIPPED" || s.status === "DELIVERED")) {
    redirectWithFlash(back(orderId), "Kargoya verilmiş paket var; iptal yerine iade süreci kullanın", "bad");
  }

  await db.$transaction([
    db.supplierOrder.updateMany({ where: { orderId }, data: { status: "CANCELLED" } }),
    db.order.update({ where: { id: orderId }, data: { status: "CANCELLED", cancelledAt: new Date() } }),
    db.payment.updateMany({ where: { orderId, status: "PENDING" }, data: { status: "CANCELLED" } }),
  ]);
  await releaseReservations(db, { orderId }, "cancelled");

  let refundMsg = "";
  for (const p of order.payments) {
    const remaining = p.amount - p.refunds.reduce((s, r) => s + r.amount, 0);
    if (remaining <= 0) continue;
    try {
      await createRefund(db, { paymentId: p.id, amount: remaining, reason, idempotencyKey: `cancel:${orderId}:${p.id}`, actorId: user.id });
      refundMsg = " Ücret iadesi yapıldı.";
    } catch (error) {
      refundMsg = ` İade başarısız: ${error instanceof RefundError ? error.message : "bilinmeyen hata"}`;
    }
  }
  await audit({ action: "order.cancelled", actorType: "USER", actorId: user.id, entityType: "Order", entityId: orderId, metadata: { reason } });
  const submitted = order.supplierOrders.filter((s) => s.externalOrderId).length;
  redirectWithFlash(
    back(orderId),
    `Sipariş iptal edildi.${refundMsg}${submitted ? ` Dikkat: ${submitted} tedarikçi siparişi daha önce iletilmişti, tedarikçi tarafında da iptal edin.` : ""}`,
    refundMsg.includes("başarısız") ? "bad" : "ok",
  );
}
