/**
 * Kargo yöntemleri ve ücret hesabı. Ücretler Setting tablosundaki "shipping"
 * anahtarından okunur; burada yalnızca varsayılanlar ve saf hesap vardır.
 */

export type ShippingMethodId = "standard" | "express";

export type ShippingSettings = {
  freeShippingThreshold: number;
  methods: Record<ShippingMethodId, { label: string; fee: number; etaDays: string; enabled: boolean }>;
};

export const DEFAULT_SHIPPING_SETTINGS: ShippingSettings = {
  freeShippingThreshold: 75_000,
  methods: {
    standard: { label: "Standart Kargo", fee: 7_990, etaDays: "2-4 iş günü", enabled: true },
    express: { label: "Hızlı Kargo", fee: 14_990, etaDays: "1-2 iş günü", enabled: true },
  },
};

export const SHIPPING_METHOD_IDS: readonly ShippingMethodId[] = ["standard", "express"];

export function shippingFee(subtotal: number, method: ShippingMethodId, settings: ShippingSettings = DEFAULT_SHIPPING_SETTINGS): number {
  const cfg = settings.methods[method];
  if (!cfg?.enabled) throw new Error(`Kargo yöntemi kullanılamıyor: ${method}`);
  // Ücretsiz kargo yalnızca standart gönderimde geçerlidir.
  if (method === "standard" && subtotal >= settings.freeShippingThreshold) return 0;
  return cfg.fee;
}
