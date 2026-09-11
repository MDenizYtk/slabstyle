import { randomToken } from "../../security/crypto";
import { WebhookSignatureError, type PaymentProvider } from "../types";

/**
 * Havale / EFT. Online bir sağlayıcı yoktur: müşteriye IBAN gösterilir, para
 * hesaba geldiğinde admin panelinden "Havale geldi" ile ödeme onaylanır
 * (payments/service.ts → capturePayment). İadeler de bankadan elle yapılır.
 */
export class BankTransferProvider implements PaymentProvider {
  readonly key = "bank_transfer";

  async createPayment(input: { paymentId: string }) {
    return { providerPaymentId: `bt_${input.paymentId}`, redirectUrl: `/checkout/transfer/${input.paymentId}` };
  }

  async parseWebhook(): Promise<never> {
    throw new WebhookSignatureError("Havale/EFT için webhook yoktur");
  }

  /** Kayıt amaçlıdır: tutarın müşteriye bankadan elle gönderilmesi gerekir. */
  async refund() {
    return { providerRefundId: `manual_${randomToken(8)}`, status: "SUCCEEDED" as const };
  }
}
