/**
 * Ödeme sağlayıcı sözleşmesi. iyzico, PayTR, Stripe gibi gerçek sağlayıcılar bu
 * arayüzü uygulayan bir sınıf olarak eklenir; sipariş ve webhook akışı değişmez.
 */

export type CreatePaymentInput = {
  paymentId: string;
  orderId: string;
  orderNumber: number;
  amount: number;
  currency: string;
  email: string;
  returnUrl: string;
};

export type CreatePaymentResult = { providerPaymentId: string; redirectUrl: string };

export type PaymentWebhookEvent = {
  eventId: string;
  type: "payment.succeeded" | "payment.failed" | "refund.succeeded" | "refund.failed" | "other";
  providerPaymentId?: string;
  providerRefundId?: string;
  amount?: number;
  currency?: string;
  failureReason?: string;
};

export type RefundResult = { providerRefundId: string; status: "SUCCEEDED" | "PENDING" | "FAILED"; failureReason?: string };

export interface PaymentProvider {
  readonly key: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** İmzayı doğrular; geçersizse WebhookSignatureError fırlatır. */
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentWebhookEvent>;
  refund(input: { providerPaymentId: string; amount: number; idempotencyKey: string }): Promise<RefundResult>;
}

export class WebhookSignatureError extends Error {}
