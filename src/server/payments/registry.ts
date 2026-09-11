import { BankTransferProvider } from "./providers/bank-transfer";
import { MockPaymentProvider } from "./providers/mock";
import type { PaymentProvider } from "./types";

/**
 * Ödeme sağlayıcıları. Kartla ödeme için aktif sağlayıcı PAYMENT_PROVIDER ile
 * seçilir (gerçek sağlayıcı eklendiğinde buraya tek satır). Havale/EFT her
 * zaman "bank_transfer" sağlayıcısıdır ve admin ayarlarından açılır.
 */
const PROVIDERS: Record<string, () => PaymentProvider> = {
  mock: () => new MockPaymentProvider(),
  bank_transfer: () => new BankTransferProvider(),
};

export type PaymentMethodId = "card" | "bank_transfer";

export const BANK_TRANSFER_PROVIDER = "bank_transfer";

export function providerKeyFor(method: PaymentMethodId): string {
  return method === "bank_transfer" ? BANK_TRANSFER_PROVIDER : (process.env.PAYMENT_PROVIDER ?? "mock");
}

/** Canlıda MOCK kart ödemesi kapalıdır (ödemesiz siparişin "ödendi" olmaması için). */
export function isCardPaymentAvailable(): boolean {
  const key = process.env.PAYMENT_PROVIDER ?? "mock";
  return !(key === "mock" && process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_PAYMENTS !== "1");
}

export function getPaymentProvider(key = process.env.PAYMENT_PROVIDER ?? "mock"): PaymentProvider {
  if (key === "mock" && !isCardPaymentAvailable()) {
    throw new Error("Üretimde MOCK ödeme sağlayıcısı kullanılamaz. PAYMENT_PROVIDER ayarlayın.");
  }
  const factory = PROVIDERS[key];
  if (!factory) throw new Error(`Bilinmeyen ödeme sağlayıcısı: ${key}`);
  return factory();
}
