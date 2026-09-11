import { paymentStatusAfterRefund, validateRefund } from "@/domain/payments/refund";
import type { DbClient } from "../db";
import { audit } from "../audit";
import { logger } from "../logger";
import { getPaymentProvider } from "./registry";

export class RefundError extends Error {}

/**
 * Ücret iadesi. idempotencyKey ile aynı iade iki kez yapılmaz (ör. admin iki kez
 * tıklarsa ya da iş tekrar denenirse). Tutar, tahsil edilen ve daha önce iade
 * edilen tutara göre doğrulanır.
 */
export async function createRefund(
  db: DbClient,
  input: { paymentId: string; amount: number; reason: string; idempotencyKey: string; returnId?: string; actorId?: string },
) {
  const existing = await db.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  const payment = await db.payment.findUnique({
    where: { id: input.paymentId },
    select: { id: true, provider: true, providerPaymentId: true, amount: true, status: true, orderId: true, refunds: { where: { status: { in: ["SUCCEEDED", "PENDING", "PROCESSING"] } }, select: { amount: true } } },
  });
  if (!payment || !payment.providerPaymentId) throw new RefundError("Ödeme bulunamadı");
  if (!["CAPTURED", "PARTIALLY_REFUNDED"].includes(payment.status)) throw new RefundError("Bu ödeme iade edilebilir durumda değil");

  const alreadyRefunded = payment.refunds.reduce((s, r) => s + r.amount, 0);
  const check = validateRefund(input.amount, payment.amount, alreadyRefunded);
  if (!check.ok) throw new RefundError(check.reason);

  const refund = await db.refund.create({
    data: { paymentId: payment.id, returnId: input.returnId, amount: input.amount, reason: input.reason, idempotencyKey: input.idempotencyKey, status: "PROCESSING" },
  });

  try {
    const result = await getPaymentProvider(payment.provider).refund({
      providerPaymentId: payment.providerPaymentId,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
    });
    const status = result.status === "SUCCEEDED" ? "SUCCEEDED" : result.status === "FAILED" ? "FAILED" : "PROCESSING";
    const updated = await db.refund.update({
      where: { id: refund.id },
      data: { status, providerRefundId: result.providerRefundId, failureReason: result.failureReason, processedAt: status === "SUCCEEDED" ? new Date() : null },
    });
    if (status === "SUCCEEDED") await applyRefundSucceeded(db, payment.id);
    await audit({ action: `refund.${status.toLowerCase()}`, actorType: input.actorId ? "USER" : "SYSTEM", actorId: input.actorId, entityType: "Refund", entityId: refund.id, metadata: { amount: input.amount, orderId: payment.orderId } });
    return updated;
  } catch (error) {
    logger.error("refund.failed", { refundId: refund.id, error: String(error) });
    await db.refund.update({ where: { id: refund.id }, data: { status: "FAILED", failureReason: String(error).slice(0, 500) } });
    throw new RefundError("İade ödeme sağlayıcısında başarısız oldu");
  }
}

/** Başarılı iade sonrası ödeme ve sipariş durumlarını günceller. */
export async function applyRefundSucceeded(db: DbClient, paymentId: string) {
  const payment = await db.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { amount: true, orderId: true, refunds: { where: { status: "SUCCEEDED" }, select: { amount: true } } },
  });
  const total = payment.refunds.reduce((s, r) => s + r.amount, 0);
  const status = paymentStatusAfterRefund(payment.amount, total);
  await db.payment.update({ where: { id: paymentId }, data: { status } });
  // İptal edilmiş sipariş iptal olarak kalır; diğerleri iade durumuna geçer.
  await db.order.updateMany({ where: { id: payment.orderId, status: { not: "CANCELLED" } }, data: { status } });
}
