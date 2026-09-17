"use server";

import { revalidatePath } from "next/cache";
import { isValidTrIban, normalizeIban } from "@/domain/payments/iban";
import { parseTlInput } from "@/lib/money";
import { db } from "./db";
import { audit } from "./audit";
import { requireAdmin } from "./auth/dal";
import { redirectWithFlash } from "./admin/flash";
import { normalizeWhatsapp } from "@/components/store/ContactCTA";
import { bankTransferSchema, contactSchema, getShippingSettings, SETTING_KEYS, shippingSettingsSchema } from "./settings";

const BACK = "/admin/settings";

export async function saveContactAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const value = {
    whatsapp: String(formData.get("whatsapp") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    note: String(formData.get("note") ?? "").trim(),
  };
  const parsed = contactSchema.safeParse(value);
  if (!parsed.success) redirectWithFlash(BACK, "İletişim bilgileri çok uzun", "bad");
  if (value.whatsapp && !normalizeWhatsapp(value.whatsapp)) redirectWithFlash(BACK, "WhatsApp numarası geçersiz (ör. 0555 111 22 33)", "bad");
  if (value.email && !value.email.includes("@")) redirectWithFlash(BACK, "E-posta geçersiz", "bad");

  await db.setting.upsert({ where: { key: SETTING_KEYS.contact }, create: { key: SETTING_KEYS.contact, value: parsed.data }, update: { value: parsed.data } });
  await audit({ action: "settings.contact_updated", actorType: "USER", actorId: user.id, entityType: "Setting", entityId: SETTING_KEYS.contact });
  revalidatePath("/", "layout");
  redirectWithFlash(BACK, "İletişim bilgileri kaydedildi");
}

export async function saveBankTransferAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const value = {
    enabled: formData.get("enabled") === "on",
    accountHolder: String(formData.get("accountHolder") ?? "").trim(),
    bankName: String(formData.get("bankName") ?? "").trim(),
    iban: normalizeIban(String(formData.get("iban") ?? "")),
    note: String(formData.get("note") ?? "").trim(),
    expireHours: Number(formData.get("expireHours") ?? 48),
  };
  const parsed = bankTransferSchema.safeParse(value);
  if (!parsed.success) redirectWithFlash(BACK, "Havale ayarları geçersiz (süre 1-168 saat olmalı)", "bad");
  if (value.iban && !isValidTrIban(value.iban)) redirectWithFlash(BACK, "IBAN geçersiz: TR ile başlayan 26 karakter olmalı ve kontrol hanesi tutmalı", "bad");
  if (value.enabled && (!value.iban || value.accountHolder.length < 3)) {
    redirectWithFlash(BACK, "Havaleyi açmak için geçerli IBAN ve hesap sahibi adı gerekli", "bad");
  }
  await db.setting.upsert({ where: { key: SETTING_KEYS.bankTransfer }, create: { key: SETTING_KEYS.bankTransfer, value: parsed.data }, update: { value: parsed.data } });
  // IBAN değişikliği denetim kaydına yazılır (dolandırıcılık girişimlerini fark etmek için).
  await audit({ action: "settings.bank_transfer_updated", actorType: "USER", actorId: user.id, entityType: "Setting", entityId: SETTING_KEYS.bankTransfer, metadata: { enabled: value.enabled, ibanLast4: value.iban.slice(-4) } });
  revalidatePath("/checkout");
  redirectWithFlash(BACK, value.enabled ? "Havale/EFT açık; müşteriler ödeme adımında görecek" : "Havale ayarları kaydedildi (kapalı)");
}

export async function saveShippingSettingsAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const current = await getShippingSettings(db);
  const tl = (name: string) => parseTlInput(formData.get(name));
  const threshold = tl("freeShippingThreshold");
  const standardFee = tl("standardFee");
  const expressFee = tl("expressFee");
  if ([threshold, standardFee, expressFee].some((v) => v === null || Number.isNaN(v))) redirectWithFlash(BACK, "Kargo tutarları geçersiz (ör. 79,90)", "bad");

  const value = {
    freeShippingThreshold: threshold!,
    methods: {
      standard: { ...current.methods.standard, fee: standardFee!, etaDays: String(formData.get("standardEta") ?? current.methods.standard.etaDays).slice(0, 40), enabled: true },
      express: { ...current.methods.express, fee: expressFee!, etaDays: String(formData.get("expressEta") ?? current.methods.express.etaDays).slice(0, 40), enabled: formData.get("expressEnabled") === "on" },
    },
  };
  const parsed = shippingSettingsSchema.safeParse(value);
  if (!parsed.success) redirectWithFlash(BACK, "Kargo ayarları geçersiz", "bad");
  await db.setting.upsert({ where: { key: SETTING_KEYS.shipping }, create: { key: SETTING_KEYS.shipping, value: parsed.data }, update: { value: parsed.data } });
  await audit({ action: "settings.shipping_updated", actorType: "USER", actorId: user.id, entityType: "Setting", entityId: SETTING_KEYS.shipping, metadata: parsed.data });
  revalidatePath("/", "layout");
  redirectWithFlash(BACK, "Kargo ayarları kaydedildi");
}
