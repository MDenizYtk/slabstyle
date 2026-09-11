"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "../db";
import { requireAdmin } from "../auth/dal";
import { redirectWithFlash } from "../admin/flash";
import { capturePayment } from "./service";

/**
 * Havale/EFT onayı: para hesaba geldiğinde admin ödemeyi onaylar. Sipariş kartla
 * ödenmiş gibi aynı akışa girer (PAID → tedarikçi ataması).
 */
export async function confirmBankTransferAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const paymentId = z.string().min(1).max(40).parse(formData.get("paymentId"));
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: { provider: true, status: true, orderId: true, order: { select: { status: true, number: true } } },
  });
  if (!payment || payment.provider !== "bank_transfer") redirectWithFlash("/admin/orders", "Havale ödemesi bulunamadı", "bad");
  const back = `/admin/orders/${payment.orderId}`;
  if (payment.order.status !== "PENDING_PAYMENT") {
    redirectWithFlash(back, "Sipariş ödeme beklemiyor (süresi dolup iptal edilmiş olabilir). Para geldiyse müşteriye iade edin veya yeni sipariş oluşturulsun.", "bad");
  }

  const result = await capturePayment(db, paymentId, { type: "USER", id: user.id });
  revalidatePath(back);
  revalidatePath("/admin");
  redirectWithFlash(
    back,
    result === "PAID" ? `#${payment.order.number} için havale onaylandı; sipariş hazırlanmaya alındı` : "Bu ödeme zaten onaylanmış",
    result === "PAID" ? "ok" : "bad",
  );
}
