import { z } from "zod";
import { DEFAULT_PRICING_SETTINGS, type PricingSettings } from "@/domain/pricing/engine";
import { DEFAULT_SHIPPING_SETTINGS, type ShippingSettings } from "@/domain/shipping/methods";
import type { DbClient } from "./db";

const rounding = z.enum(["NONE", "WHOLE", "END_90", "END_99"]);

const pricingSettingsSchema = z.object({
  defaultMarginBps: z.number().int().min(0).max(50_000),
  defaultRounding: rounding,
  minMarginBps: z.number().int().min(0).max(50_000),
  minProfit: z.number().int().min(0),
});

const methodSchema = z.object({
  label: z.string(),
  fee: z.number().int().min(0),
  etaDays: z.string(),
  enabled: z.boolean(),
});

const shippingSettingsSchema = z.object({
  freeShippingThreshold: z.number().int().min(0),
  methods: z.object({ standard: methodSchema, express: methodSchema }),
});

export const SETTING_KEYS = { pricing: "pricing", shipping: "shipping", bankTransfer: "bankTransfer" } as const;

/** Havale / EFT ile ödeme bilgileri (admin → Ayarlar). */
export const bankTransferSchema = z.object({
  enabled: z.boolean(),
  accountHolder: z.string().max(120),
  bankName: z.string().max(80),
  iban: z.string().max(40),
  note: z.string().max(500),
  /** Ödeme yapılmayan havale siparişleri bu süre sonunda iptal edilir. */
  expireHours: z.number().int().min(1).max(168),
});

export type BankTransferSettings = z.infer<typeof bankTransferSchema>;

export const DEFAULT_BANK_TRANSFER: BankTransferSettings = {
  enabled: false,
  accountHolder: "",
  bankName: "",
  iban: "",
  note: "",
  expireHours: 48,
};

async function readSetting<T>(db: DbClient, key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  const parsed = schema.safeParse({ ...fallback, ...(row.value as object) });
  return parsed.success ? parsed.data : fallback;
}

export function getPricingSettings(db: DbClient): Promise<PricingSettings> {
  return readSetting(db, SETTING_KEYS.pricing, pricingSettingsSchema, DEFAULT_PRICING_SETTINGS);
}

export function getShippingSettings(db: DbClient): Promise<ShippingSettings> {
  return readSetting(db, SETTING_KEYS.shipping, shippingSettingsSchema, DEFAULT_SHIPPING_SETTINGS);
}

export function getBankTransferSettings(db: DbClient): Promise<BankTransferSettings> {
  return readSetting(db, SETTING_KEYS.bankTransfer, bankTransferSchema, DEFAULT_BANK_TRANSFER);
}

export { pricingSettingsSchema, shippingSettingsSchema };
