import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "../db";
import { audit } from "../audit";
import { logger } from "../logger";
import { releaseReservations } from "../orders/reservations";
import { scheduleOrderJob } from "../orders/jobs";
import { applyRefundSucceeded, createRefund } from "./refund";
import { getPaymentProvider } from "./registry";
import { WebhookSignatureError, type PaymentWebhookEvent } from "./types";

export class PaymentError extends Error {}

/** Sipariş için yeni bir ödeme denemesi başlatır ve yönlendirme adresini döner. */
export async function startPayment(db: DbClient, orderId: string, userId: string): Promise<string> {
  const order = await db.order.findFirst({
    where: { id: orderId, userId },
    select: { id: true, number: true, status: true, grandTotal: true, currency: true, email: true, _count: { select: { payments: true } } },
  });
  if (!order) throw new PaymentError("Sipariş bulunamadı");
  if (order.status !== "PENDING_PAYMENT") throw new PaymentError("Bu sipariş için ödeme beklenmiyor");

  const provider = getPaymentProvider();
  // Önceki bekleyen denemeler iptal: tek seferde tek aktif ödeme.
  await db.payment.updateMany({ where: { orderId, status: "PENDING" }, data: { status: "CANCELLED" } });
  const payment = await db.payment.create({
    data: { orderId, provider: provider.key, amount: order.grandTotal, currency: order.currency, idempotencyKey: `pay:${orderId}:${order._count.payments + 1}` },
    select: { id: true },
  });
  const result = await provider.createPayment({
    paymentId: payment.id,
    orderId,
    orderNumber: order.number,
    amount: order.grandTotal,
    currency: order.currency,
    email: order.email,
    returnUrl: `${process.env.APP_URL ?? ""}/checkout/success/${orderId}`,
  });
  await db.payment.update({ where: { id: payment.id }, data: { providerPaymentId: result.providerPaymentId } });
  await audit({ action: "payment.started", actorType: "USER", actorId: userId, entityType: "Payment", entityId: payment.id, metadata: { orderId } });
  return result.redirectUrl;
}

export type WebhookResult = { status: number; body: { ok: boolean; duplicate?: boolean; error?: string } };

/**
 * Ödeme webhook'u. Sıra:
 * 1) İmza doğrulama (geçersizse 401, hiçbir şey yazılmaz)
 * 2) Olay kaydı: (provider, eventId) tekil. Daha önce işlenmişse 200 "duplicate".
 * 3) İşleme; hata olursa 500 döner ve sağlayıcı tekrar gönderir (FAILED olay yeniden işlenir).
 */
export async function processPaymentWebhook(db: DbClient, providerKey: string, rawBody: string, headers: Headers): Promise<WebhookResult> {
  let event: PaymentWebhookEvent;
  try {
    event = await getPaymentProvider(providerKey).parseWebhook(rawBody, headers);
  } catch (error) {
    const signature = error instanceof WebhookSignatureError;
    logger.warn("webhook.rejected", { provider: providerKey, reason: signature ? "signature" : String(error) });
    return { status: signature ? 401 : 400, body: { ok: false, error: signature ? "invalid signature" : "invalid payload" } };
  }

  let record: { id: string; status: string };
  try {
    record = await db.webhookEvent.create({
      data: { provider: providerKey, externalEventId: event.eventId, eventType: event.type, payload: JSON.parse(rawBody), signatureValid: true },
      select: { id: true, status: true },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    record = await db.webhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider: providerKey, externalEventId: event.eventId } },
      select: { id: true, status: true },
    });
    if (record.status === "PROCESSED" || record.status === "IGNORED") {
      logger.info("webhook.duplicate", { provider: providerKey, eventId: event.eventId });
      return { status: 200, body: { ok: true, duplicate: true } };
    }
  }

  try {
    const outcome = await handlePaymentEvent(db, providerKey, event);
    await db.webhookEvent.update({ where: { id: record.id }, data: { status: outcome, processedAt: new Date(), attempts: { increment: 1 }, error: null } });
    return { status: 200, body: { ok: true } };
  } catch (error) {
    logger.error("webhook.failed", { provider: providerKey, eventId: event.eventId, error: String(error) });
    await db.webhookEvent.update({ where: { id: record.id }, data: { status: "FAILED", attempts: { increment: 1 }, error: String(error).slice(0, 1000) } });
    return { status: 500, body: { ok: false, error: "processing failed" } };
  }
}

async function handlePaymentEvent(db: DbClient, providerKey: string, event: PaymentWebhookEvent): Promise<"PROCESSED" | "IGNORED"> {
  if (event.type === "refund.succeeded" || event.type === "refund.failed") {
    if (!event.providerRefundId) return "IGNORED";
    const refund = await db.refund.findFirst({ where: { providerRefundId: event.providerRefundId }, select: { id: true, paymentId: true, status: true } });
    if (!refund || refund.status === "SUCCEEDED") return "IGNORED";
    await db.refund.update({
      where: { id: refund.id },
      data: event.type === "refund.succeeded" ? { status: "SUCCEEDED", processedAt: new Date() } : { status: "FAILED", failureReason: event.failureReason },
    });
    if (event.type === "refund.succeeded") await applyRefundSucceeded(db, refund.paymentId);
    return "PROCESSED";
  }
  if (event.type !== "payment.succeeded" && event.type !== "payment.failed") return "IGNORED";
  if (!event.providerPaymentId) return "IGNORED";

  const payment = await db.payment.findUnique({
    where: { provider_providerPaymentId: { provider: providerKey, providerPaymentId: event.providerPaymentId } },
    select: { id: true, amount: true, currency: true, status: true, orderId: true, order: { select: { status: true } } },
  });
  if (!payment) return "IGNORED";

  if (event.type === "payment.failed") {
    if (payment.status !== "PENDING") return "IGNORED";
    await db.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: event.failureReason?.slice(0, 500) } });
    await audit({ action: "payment.failed", actorType: "WEBHOOK", entityType: "Payment", entityId: payment.id, metadata: { reason: event.failureReason ?? null } });
    return "PROCESSED";
  }

  // payment.succeeded
  if (payment.status === "CAPTURED" || payment.status === "REFUNDED" || payment.status === "PARTIALLY_REFUNDED") return "IGNORED";
  if (event.amount != null && event.amount !== payment.amount) {
    await audit({ action: "payment.amount_mismatch", actorType: "WEBHOOK", entityType: "Payment", entityId: payment.id, metadata: { expected: payment.amount, received: event.amount } });
    throw new PaymentError("Ödeme tutarı sipariş tutarıyla eşleşmiyor");
  }

  const paidOrder = await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: payment.id }, data: { status: "CAPTURED", capturedAt: new Date() } });
    const updated = await tx.order.updateMany({ where: { id: payment.orderId, status: "PENDING_PAYMENT" }, data: { status: "PAID", paidAt: new Date() } });
    return updated.count === 1;
  });
  await audit({ action: "payment.captured", actorType: "WEBHOOK", entityType: "Payment", entityId: payment.id, metadata: { orderId: payment.orderId } });

  if (paidOrder) {
    await audit({ action: "order.paid", actorType: "WEBHOOK", entityType: "Order", entityId: payment.orderId });
    await scheduleOrderJob(db, { kind: "allocate", orderId: payment.orderId });
  } else if (payment.order.status === "CANCELLED") {
    // Süresi dolmuş (stoğu serbest bırakılmış) siparişe geç gelen ödeme: otomatik iade.
    await createRefund(db, { paymentId: payment.id, amount: payment.amount, reason: "Süresi dolmuş siparişe gelen ödeme", idempotencyKey: `late:${payment.id}` });
  }
  return "PROCESSED";
}

/** Ödeme süresi dolan siparişleri iptal eder ve ayrılan stoğu satışa geri açar. */
export async function expireUnpaidOrders(db: DbClient, olderThanMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const orders = await db.order.findMany({
    where: { status: "PENDING_PAYMENT", createdAt: { lt: cutoff }, payments: { none: { status: { in: ["CAPTURED", "AUTHORIZED"] } } } },
    select: { id: true },
    take: 500,
  });
  for (const o of orders) {
    const updated = await db.order.updateMany({ where: { id: o.id, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    if (updated.count === 0) continue;
    await db.payment.updateMany({ where: { orderId: o.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    await releaseReservations(db, { orderId: o.id }, "cancelled");
    await audit({ action: "order.expired", actorType: "SYSTEM", entityType: "Order", entityId: o.id });
  }
  return orders.length;
}
