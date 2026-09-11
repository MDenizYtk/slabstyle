import { Prisma } from "@/generated/prisma/client";
import { isValidTrIban } from "@/domain/payments/iban";
import type { DbClient } from "../db";
import { audit } from "../audit";
import { logger } from "../logger";
import { releaseReservations } from "../orders/reservations";
import { scheduleOrderJob } from "../orders/jobs";
import { getBankTransferSettings } from "../settings";
import { applyRefundSucceeded, createRefund } from "./refund";
import { BANK_TRANSFER_PROVIDER, getPaymentProvider, isCardPaymentAvailable, providerKeyFor, type PaymentMethodId } from "./registry";
import { WebhookSignatureError, type PaymentWebhookEvent } from "./types";

export class PaymentError extends Error {}

export type PaymentMethodOption = { id: PaymentMethodId; label: string; description: string };

/** Checkout'ta müşteriye sunulacak ödeme yöntemleri. */
export async function getAvailablePaymentMethods(db: DbClient): Promise<PaymentMethodOption[]> {
  const methods: PaymentMethodOption[] = [];
  const bank = await getBankTransferSettings(db);
  if (bank.enabled && isValidTrIban(bank.iban)) {
    methods.push({
      id: "bank_transfer",
      label: "Havale / EFT",
      description: `Siparişten sonra IBAN bilgisi gösterilir. ${bank.expireHours} saat içinde ödeme yapılmalıdır.`,
    });
  }
  if (isCardPaymentAvailable()) {
    const isMock = (process.env.PAYMENT_PROVIDER ?? "mock") === "mock";
    methods.push({
      id: "card",
      label: "Kredi / banka kartı",
      description: isMock ? "Test ödemesi (MOCK) — gerçek para çekilmez" : "Güvenli ödeme sayfasına yönlendirilirsiniz",
    });
  }
  return methods;
}

/** Sipariş için yeni bir ödeme denemesi başlatır ve yönlendirme adresini döner. */
export async function startPayment(db: DbClient, orderId: string, userId: string, method: PaymentMethodId = "card"): Promise<string> {
  const order = await db.order.findFirst({
    where: { id: orderId, userId },
    select: { id: true, number: true, status: true, grandTotal: true, currency: true, email: true, _count: { select: { payments: true } } },
  });
  if (!order) throw new PaymentError("Sipariş bulunamadı");
  if (order.status !== "PENDING_PAYMENT") throw new PaymentError("Bu sipariş için ödeme beklenmiyor");

  if (method === "card" && !isCardPaymentAvailable()) throw new PaymentError("Kartla ödeme şu anda kullanılamıyor");
  if (method === "bank_transfer") {
    const bank = await getBankTransferSettings(db);
    if (!bank.enabled || !isValidTrIban(bank.iban)) throw new PaymentError("Havale ile ödeme şu anda kullanılamıyor");
  }

  const provider = getPaymentProvider(providerKeyFor(method));
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
  await audit({ action: "payment.started", actorType: "USER", actorId: userId, entityType: "Payment", entityId: payment.id, metadata: { orderId, provider: provider.key } });
  return result.redirectUrl;
}

export type CaptureResult = "PAID" | "ALREADY_CAPTURED" | "LATE_REFUNDED" | "ORDER_NOT_PENDING";

/**
 * Ödemeyi tahsil edildi olarak işler ve siparişi PAID yapar. Hem imzalı webhook
 * (kart) hem admin onayı (havale) bu tek fonksiyondan geçer. Tekrar çağrılırsa
 * hiçbir şey değişmez.
 */
export async function capturePayment(db: DbClient, paymentId: string, actor: { type: "WEBHOOK" | "USER"; id?: string }): Promise<CaptureResult> {
  const outcome = await db.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: ["PENDING", "AUTHORIZED", "FAILED"] } },
      data: { status: "CAPTURED", capturedAt: new Date(), failureReason: null },
    });
    if (claimed.count === 0) return "ALREADY_CAPTURED" as const;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { orderId: true } });
    const updated = await tx.order.updateMany({ where: { id: payment.orderId, status: "PENDING_PAYMENT" }, data: { status: "PAID", paidAt: new Date() } });
    return updated.count === 1 ? ("PAID" as const) : ("ORDER_NOT_PENDING" as const);
  });
  if (outcome === "ALREADY_CAPTURED") return outcome;

  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { id: true, amount: true, orderId: true, provider: true, order: { select: { status: true } } } });
  await audit({ action: "payment.captured", actorType: actor.type, actorId: actor.id, entityType: "Payment", entityId: payment.id, metadata: { orderId: payment.orderId, provider: payment.provider } });

  if (outcome === "PAID") {
    await audit({ action: "order.paid", actorType: actor.type, actorId: actor.id, entityType: "Order", entityId: payment.orderId });
    await scheduleOrderJob(db, { kind: "allocate", orderId: payment.orderId });
    return "PAID";
  }
  if (payment.order.status === "CANCELLED") {
    // Süresi dolmuş (stoğu serbest bırakılmış) siparişe geç gelen ödeme: otomatik iade.
    await createRefund(db, { paymentId: payment.id, amount: payment.amount, reason: "Süresi dolmuş siparişe gelen ödeme", idempotencyKey: `late:${payment.id}` });
    return "LATE_REFUNDED";
  }
  return "ORDER_NOT_PENDING";
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
    select: { id: true, amount: true, currency: true, status: true, orderId: true },
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
  const result = await capturePayment(db, payment.id, { type: "WEBHOOK" });
  return result === "ALREADY_CAPTURED" ? "IGNORED" : "PROCESSED";
}

/**
 * Ödeme süresi dolan siparişleri iptal eder ve ayrılan stoğu satışa geri açar.
 * Kartla ödemede süre `olderThanMinutes`; havale siparişlerinde admin
 * ayarlarındaki süre (varsayılan 48 saat) geçerlidir.
 */
export async function expireUnpaidOrders(db: DbClient, olderThanMinutes = 30): Promise<number> {
  const bank = await getBankTransferSettings(db);
  const bankCutoff = new Date(Date.now() - bank.expireHours * 3_600_000);
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const orders = await db.order.findMany({
    where: { status: "PENDING_PAYMENT", createdAt: { lt: cutoff }, payments: { none: { status: { in: ["CAPTURED", "AUTHORIZED"] } } } },
    select: { id: true, payments: { where: { provider: BANK_TRANSFER_PROVIDER, status: "PENDING" }, select: { createdAt: true } } },
    take: 500,
  });
  let expired = 0;
  for (const o of orders) {
    if (o.payments.some((p) => p.createdAt > bankCutoff)) continue; // havale süresi henüz dolmadı
    const updated = await db.order.updateMany({ where: { id: o.id, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    if (updated.count === 0) continue;
    await db.payment.updateMany({ where: { orderId: o.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    await releaseReservations(db, { orderId: o.id }, "cancelled");
    await audit({ action: "order.expired", actorType: "SYSTEM", entityType: "Order", entityId: o.id });
    expired++;
  }
  return expired;
}
