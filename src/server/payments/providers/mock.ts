/**
 * ─────────────────────────────────────────────────────────────────────────
 *  MOCK ÖDEME SAĞLAYICISI — GERÇEK PARA HAREKETİ YOKTUR.
 *  Ödeme sayfası sitenin içindeki /checkout/pay/[id] sayfasıdır. Sonuç, gerçek
 *  sağlayıcılardaki gibi imzalı bir webhook olarak işlenir; böylece aynı akış
 *  (imza doğrulama, tekrar gelen webhook koruması) test edilir.
 *  Üretimde ALLOW_MOCK_PAYMENTS=1 olmadan kullanılamaz.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { z } from "zod";
import { randomToken } from "../../security/crypto";
import { SIGNATURE_HEADER, signWebhook, verifyWebhookSignature } from "../signature";
import { WebhookSignatureError, type PaymentProvider, type PaymentWebhookEvent } from "../types";

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["payment.succeeded", "payment.failed", "refund.succeeded", "refund.failed"]),
  data: z.object({
    paymentId: z.string().optional(),
    refundId: z.string().optional(),
    amount: z.number().int().optional(),
    currency: z.string().optional(),
    reason: z.string().optional(),
  }),
});

export type MockWebhookEvent = z.infer<typeof eventSchema>;

function secret(): string {
  const s = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!s) throw new Error("PAYMENT_WEBHOOK_SECRET tanımlı değil");
  return s;
}

/** MOCK ödeme sayfası ve testler için imzalı webhook üretir. */
export function buildMockWebhook(event: MockWebhookEvent): { body: string; headers: Headers } {
  const body = JSON.stringify(event);
  return { body, headers: new Headers({ [SIGNATURE_HEADER]: signWebhook(secret(), body), "content-type": "application/json" }) };
}

export class MockPaymentProvider implements PaymentProvider {
  readonly key = "mock";

  async createPayment(input: { paymentId: string }) {
    return { providerPaymentId: `mockpay_${input.paymentId}`, redirectUrl: `/checkout/pay/${input.paymentId}` };
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentWebhookEvent> {
    if (!verifyWebhookSignature(headers.get(SIGNATURE_HEADER), rawBody, secret())) throw new WebhookSignatureError("Geçersiz imza");
    const e = eventSchema.parse(JSON.parse(rawBody));
    return {
      eventId: e.id,
      type: e.type,
      providerPaymentId: e.data.paymentId,
      providerRefundId: e.data.refundId,
      amount: e.data.amount,
      currency: e.data.currency,
      failureReason: e.data.reason,
    };
  }

  async refund() {
    return { providerRefundId: `mockref_${randomToken(9)}`, status: "SUCCEEDED" as const };
  }
}
