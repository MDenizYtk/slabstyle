"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "../db";
import { requireUser } from "../auth/dal";
import { rateLimit } from "../rate-limit";
import { getActiveCartId } from "../cart/service";
import { randomToken } from "../security/crypto";
import { addressInputSchema, CheckoutError, placeOrder, type AddressInput } from "./checkout";
import { PaymentError, processPaymentWebhook, startPayment } from "../payments/service";
import { buildMockWebhook } from "../payments/providers/mock";

export type CheckoutState = { error?: string; fieldErrors?: Record<string, string[] | undefined> };

const formSchema = z.object({
  shippingMethod: z.enum(["standard", "express"]),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  terms: z.literal("on", { message: "Sözleşmeleri onaylamanız gerekiyor" }),
  note: z.string().trim().max(500).optional(),
});

export async function placeOrderAction(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const user = await requireUser("/checkout");
  const limited = await rateLimit(`checkout:${user.id}`, 10, 60);
  if (!limited.allowed) return { error: "Çok fazla deneme. Lütfen bir dakika bekleyin." };

  const parsed = formSchema.safeParse({
    shippingMethod: formData.get("shippingMethod"),
    idempotencyKey: formData.get("idempotencyKey"),
    terms: formData.get("terms"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Formu kontrol edin" };

  const addressId = String(formData.get("addressId") ?? "new");
  let address: AddressInput;
  let saveAddress = false;
  if (addressId !== "new") {
    const saved = await db.address.findFirst({ where: { id: addressId, userId: user.id } });
    if (!saved) return { error: "Adres bulunamadı" };
    const res = addressInputSchema.safeParse({ ...saved, line2: saved.line2 ?? undefined, postalCode: saved.postalCode ?? undefined });
    if (!res.success) return { error: "Kayıtlı adres eksik; lütfen yeni adres girin" };
    address = res.data;
  } else {
    const res = addressInputSchema.safeParse({
      title: formData.get("title") || "Adres",
      fullName: formData.get("fullName"),
      phone: formData.get("phone"),
      line1: formData.get("line1"),
      line2: formData.get("line2") || undefined,
      district: formData.get("district"),
      city: formData.get("city"),
      postalCode: formData.get("postalCode") || undefined,
    });
    if (!res.success) return { fieldErrors: res.error.flatten().fieldErrors, error: "Adres bilgilerini kontrol edin" };
    address = res.data;
    saveAddress = formData.get("saveAddress") === "on";
  }

  const cartId = await getActiveCartId();
  if (!cartId) return { error: "Sepetiniz boş" };

  let target: string;
  try {
    const { orderId } = await placeOrder(db, {
      userId: user.id,
      email: user.email,
      cartId,
      address,
      saveAddress,
      shippingMethod: parsed.data.shippingMethod,
      idempotencyKey: parsed.data.idempotencyKey,
      note: parsed.data.note,
    });
    try {
      target = await startPayment(db, orderId, user.id);
    } catch (error) {
      // Sipariş oluştu ama ödeme başlatılamadı: sonuç sayfasından tekrar denenebilir.
      if (!(error instanceof PaymentError)) console.error(error);
      target = `/checkout/success/${orderId}`;
    }
  } catch (error) {
    if (error instanceof CheckoutError) return { error: error.message };
    throw error;
  }
  redirect(target);
}

export async function retryPaymentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orderId = z.string().min(1).max(40).parse(formData.get("orderId"));
  let target = `/checkout/success/${orderId}?failed=1`;
  try {
    target = await startPayment(db, orderId, user.id);
  } catch (error) {
    if (!(error instanceof PaymentError)) throw error;
  }
  redirect(target);
}

/**
 * MOCK ödeme sayfasındaki butonlar. Gerçek sağlayıcıdaki gibi imzalı bir webhook
 * üretip aynı webhook işleyicisinden geçirir. Yalnızca mock sağlayıcıda çalışır.
 */
export async function mockPayAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const paymentId = z.string().min(1).max(40).parse(formData.get("paymentId"));
  const outcome = z.enum(["success", "fail"]).parse(formData.get("outcome"));
  const payment = await db.payment.findFirst({
    where: { id: paymentId, provider: "mock", order: { userId: user.id } },
    select: { providerPaymentId: true, amount: true, currency: true, orderId: true },
  });
  if (!payment?.providerPaymentId) redirect("/account/orders");

  const { body, headers } = buildMockWebhook({
    id: `evt_${randomToken(12)}`,
    type: outcome === "success" ? "payment.succeeded" : "payment.failed",
    data: { paymentId: payment.providerPaymentId, amount: payment.amount, currency: payment.currency, reason: outcome === "fail" ? "Kart reddedildi (MOCK)" : undefined },
  });
  await processPaymentWebhook(db, "mock", body, headers);
  redirect(`/checkout/success/${payment.orderId}${outcome === "fail" ? "?failed=1" : ""}`);
}
