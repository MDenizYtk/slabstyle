/** İade (refund) tutar kuralları. */

export type RefundCheck = { ok: true } | { ok: false; reason: string };

export function validateRefund(amount: number, captured: number, alreadyRefunded: number): RefundCheck {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: "İade tutarı pozitif olmalı" };
  if (captured <= 0) return { ok: false, reason: "Tahsil edilmiş ödeme yok" };
  const remaining = captured - alreadyRefunded;
  if (amount > remaining) return { ok: false, reason: `İade tutarı iade edilebilir tutarı (${remaining} kuruş) aşıyor` };
  return { ok: true };
}

export function paymentStatusAfterRefund(captured: number, totalRefunded: number): "REFUNDED" | "PARTIALLY_REFUNDED" {
  return totalRefunded >= captured ? "REFUNDED" : "PARTIALLY_REFUNDED";
}

export function refundAmountForItems(items: readonly { unitPrice: number; quantity: number }[]): number {
  return items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
}
