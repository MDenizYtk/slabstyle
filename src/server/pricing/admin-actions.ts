"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseTlInput } from "@/lib/money";
import { db } from "../db";
import { audit } from "../audit";
import { requireAdmin } from "../auth/dal";
import { redirectWithFlash } from "../admin/flash";
import { SETTING_KEYS } from "../settings";
import { recalculateForSupplier } from "../catalog/recalculate";
import { getQueue, QUEUES } from "../queue";
import { logger } from "../logger";

const BACK = "/admin/pricing";
const rounding = z.enum(["NONE", "WHOLE", "END_90", "END_99"]);
const percentToBps = (v: unknown) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
};

/**
 * Kural değişince tüm fiyatlar yeniden hesaplanmalı. Büyük katalogda bu işi
 * worker yapar; kuyruk yoksa (yerel geliştirme) istek içinde çalışır.
 */
async function scheduleFullRecalc() {
  try {
    await Promise.race([
      getQueue(QUEUES.maintenance).add("recalc-all", {}, { jobId: `recalc-all:${Math.floor(Date.now() / 10_000)}` }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
    ]);
    return "Fiyatlar arka planda yeniden hesaplanıyor";
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
    logger.warn("pricing.inline_recalc", { error: String(error) });
    const stats = await recalculateForSupplier(db);
    return `${stats.variants} varyantın fiyatı yeniden hesaplandı (${stats.priceChanged} değişti)`;
  }
}

const ruleSchema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(2).max(120),
  scope: z.enum(["GLOBAL", "SUPPLIER", "CATEGORY", "BRAND"]),
  supplierId: z.string().max(40).optional(),
  categoryId: z.string().max(40).optional(),
  brandId: z.string().max(40).optional(),
  priority: z.coerce.number().int().min(-1000).max(1000),
  rounding,
  isActive: z.preprocess((v) => v === "on", z.boolean()),
});

export async function saveRuleAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirectWithFlash(BACK, parsed.error.issues[0]?.message ?? "Geçersiz kural", "bad");
  const d = parsed.data;
  const marginBps = percentToBps(formData.get("marginPercent"));
  const minCost = parseTlInput(formData.get("minCost"));
  const maxCost = parseTlInput(formData.get("maxCost"));
  const fixedMarkup = parseTlInput(formData.get("fixedMarkup")) ?? 0;

  if (!Number.isInteger(marginBps) || marginBps < 0 || marginBps > 50_000) redirectWithFlash(BACK, "Marj %0 ile %500 arasında olmalı", "bad");
  if ([minCost, maxCost, fixedMarkup].some((v) => Number.isNaN(v))) redirectWithFlash(BACK, "Tutar biçimi geçersiz", "bad");
  if (minCost != null && maxCost != null && minCost >= maxCost) redirectWithFlash(BACK, "Alt maliyet üst maliyetten küçük olmalı", "bad");
  const scopeRef = { SUPPLIER: d.supplierId, CATEGORY: d.categoryId, BRAND: d.brandId, GLOBAL: "x" }[d.scope];
  if (!scopeRef) redirectWithFlash(BACK, "Kapsam için tedarikçi/kategori/marka seçin", "bad");

  const data = {
    name: d.name,
    scope: d.scope,
    supplierId: d.scope === "SUPPLIER" ? d.supplierId : null,
    categoryId: d.scope === "CATEGORY" ? d.categoryId : null,
    brandId: d.scope === "BRAND" ? d.brandId : null,
    minCost,
    maxCost,
    marginBps,
    fixedMarkup,
    priority: d.priority,
    rounding: d.rounding,
    isActive: d.isActive,
  };
  const rule = d.id ? await db.pricingRule.update({ where: { id: d.id }, data }) : await db.pricingRule.create({ data });
  await audit({ action: d.id ? "pricing.rule_updated" : "pricing.rule_created", actorType: "USER", actorId: user.id, entityType: "PricingRule", entityId: rule.id, metadata: data });
  const msg = await scheduleFullRecalc();
  revalidatePath(BACK);
  redirectWithFlash(BACK, `Kural kaydedildi. ${msg}`);
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const id = z.string().min(1).max(40).parse(formData.get("id"));
  await db.pricingRule.delete({ where: { id } });
  await audit({ action: "pricing.rule_deleted", actorType: "USER", actorId: user.id, entityType: "PricingRule", entityId: id });
  const msg = await scheduleFullRecalc();
  redirectWithFlash(BACK, `Kural silindi. ${msg}`);
}

export async function saveSettingsAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const value = {
    defaultMarginBps: percentToBps(formData.get("defaultMarginPercent")),
    minMarginBps: percentToBps(formData.get("minMarginPercent")),
    minProfit: parseTlInput(formData.get("minProfit")) ?? 0,
    defaultRounding: rounding.catch("END_90").parse(formData.get("defaultRounding")),
  };
  if ([value.defaultMarginBps, value.minMarginBps, value.minProfit].some((v) => !Number.isInteger(v) || v < 0)) {
    redirectWithFlash(BACK, "Ayar değerleri geçersiz", "bad");
  }
  await db.setting.upsert({ where: { key: SETTING_KEYS.pricing }, create: { key: SETTING_KEYS.pricing, value }, update: { value } });
  await audit({ action: "pricing.settings_updated", actorType: "USER", actorId: user.id, entityType: "Setting", entityId: SETTING_KEYS.pricing, metadata: value });
  const msg = await scheduleFullRecalc();
  redirectWithFlash(BACK, `Ayarlar kaydedildi. ${msg}`);
}
