import { MockPaymentProvider } from "./providers/mock";
import type { PaymentProvider } from "./types";

/**
 * Ödeme sağlayıcı seçimi. Gerçek sağlayıcı eklendiğinde (ör. iyzico) buraya
 * tek satır eklenir ve PAYMENT_PROVIDER ortam değişkeni değiştirilir.
 */
const PROVIDERS: Record<string, () => PaymentProvider> = {
  mock: () => new MockPaymentProvider(),
};

export function getPaymentProvider(key = process.env.PAYMENT_PROVIDER ?? "mock"): PaymentProvider {
  if (key === "mock" && process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_PAYMENTS !== "1") {
    throw new Error("Üretimde MOCK ödeme sağlayıcısı kullanılamaz. PAYMENT_PROVIDER ayarlayın.");
  }
  const factory = PROVIDERS[key];
  if (!factory) throw new Error(`Bilinmeyen ödeme sağlayıcısı: ${key}`);
  return factory();
}
