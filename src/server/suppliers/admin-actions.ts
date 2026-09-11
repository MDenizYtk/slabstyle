"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { requireAdmin, requireStaff } from "../auth/dal";
import { encryptSecret } from "../security/crypto";
import { runManualImport } from "../sync/engine";
import { fieldMapSchema, priceFormatSchema } from "./mapping";
import { normalizeRecords, parseFeedRecords } from "./adapters/feed";
import { parseXlsx } from "./excel";
import { ADAPTERS, createAdapter, decodeCredentials, validateAdapterConfig } from "./registry";
import type { NormalizedProduct } from "./types";

export type SupplierFormState = { ok?: boolean; message?: string; fieldErrors?: Record<string, string[] | undefined> };
export type TestResultState = { ok?: boolean; message?: string; sample?: Partial<NormalizedProduct>[] };

const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

const supplierSchema = z.object({
  id: z.string().max(40).optional(),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, "Küçük harf, rakam ve tire (2-40 karakter)"),
  name: z.string().trim().min(2).max(120),
  status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]),
  integrationType: z.enum(["REST_API", "XML_FEED", "CSV_FEED", "JSON_FEED", "MANUAL_IMPORT", "CUSTOM", "MOCK"]),
  adapterKey: z.string().refine((k) => k in ADAPTERS, "Bilinmeyen adapter"),
  priority: z.coerce.number().int().min(-100).max(100),
  defaultLeadTimeDays: z.coerce.number().int().min(0).max(60),
  safetyStock: z.coerce.number().int().min(0).max(10_000),
  stockSyncIntervalMin: z.coerce.number().int().min(5).max(1440),
  catalogSyncIntervalMin: z.coerce.number().int().min(30).max(10_080),
  autoSubmitOrders: checkbox,
  notes: z.string().trim().max(2000).optional(),
  config: z.string().max(50_000),
});

export async function saveSupplierAction(_prev: SupplierFormState, formData: FormData): Promise<SupplierFormState> {
  const user = await requireAdmin();
  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors, message: "Formu kontrol edin" };
  const { id, config: configText, ...data } = parsed.data;

  let config: Prisma.InputJsonValue;
  try {
    config = JSON.parse(configText || "{}");
  } catch {
    return { ok: false, fieldErrors: { config: ["Geçerli JSON değil"] } };
  }
  const valid = validateAdapterConfig(data.adapterKey, config);
  if (!valid.ok) return { ok: false, fieldErrors: { config: [valid.message] } };

  const clash = await db.supplier.findFirst({ where: { code: data.code, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
  if (clash) return { ok: false, fieldErrors: { code: ["Bu kod kullanılıyor"] } };

  const saved = id
    ? await db.supplier.update({ where: { id }, data: { ...data, config }, select: { id: true } })
    : await db.supplier.create({ data: { ...data, config }, select: { id: true } });

  await audit({ action: id ? "supplier.updated" : "supplier.created", actorType: "USER", actorId: user.id, entityType: "Supplier", entityId: saved.id, metadata: { code: data.code, adapterKey: data.adapterKey } });
  revalidatePath("/admin/suppliers");
  if (!id) redirect(`/admin/suppliers/${saved.id}`);
  revalidatePath(`/admin/suppliers/${saved.id}`);
  return { ok: true, message: "Kaydedildi" };
}

/**
 * Kimlik bilgileri yalnızca yazılır: mevcut değerler asla forma geri gönderilmez.
 * Boş bırakılan alan mevcut değeri korur.
 */
export async function saveCredentialsAction(_prev: SupplierFormState, formData: FormData): Promise<SupplierFormState> {
  const user = await requireAdmin();
  const supplierId = String(formData.get("supplierId") ?? "");
  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, adapterKey: true, credentialsEncrypted: true } });
  if (!supplier) return { ok: false, message: "Tedarikçi bulunamadı" };

  const allowed = [...(ADAPTERS[supplier.adapterKey]?.credentialFields ?? []), "webhookSecret"];
  const current = formData.get("clear") === "on" ? {} : decodeCredentials(supplier.credentialsEncrypted);
  for (const key of allowed) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) current[key] = value.slice(0, 4096);
  }
  const keys = Object.keys(current);
  await db.supplier.update({
    where: { id: supplier.id },
    data: { credentialsEncrypted: keys.length ? encryptSecret(JSON.stringify(current)) : null },
  });
  // Denetim kaydına yalnızca alan adları yazılır, değerler asla.
  await audit({ action: "supplier.credentials_updated", actorType: "USER", actorId: user.id, entityType: "Supplier", entityId: supplier.id, metadata: { keys } });
  revalidatePath(`/admin/suppliers/${supplier.id}`);
  return { ok: true, message: keys.length ? `Kayıtlı alanlar: ${keys.join(", ")}` : "Kimlik bilgileri temizlendi" };
}

export async function testConnectionAction(_prev: TestResultState, formData: FormData): Promise<TestResultState> {
  const user = await requireStaff();
  const supplier = await db.supplier.findUnique({
    where: { id: String(formData.get("supplierId") ?? "") },
    select: { id: true, code: true, adapterKey: true, config: true, credentialsEncrypted: true },
  });
  if (!supplier) return { ok: false, message: "Tedarikçi bulunamadı" };
  try {
    const result = await Promise.race([
      createAdapter(supplier).testConnection(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Bağlantı testi 60 saniyede tamamlanmadı")), 60_000)),
    ]);
    await audit({ action: "supplier.connection_test", actorType: "USER", actorId: user.id, entityType: "Supplier", entityId: supplier.id, metadata: { ok: result.ok } });
    return result;
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

const importConfigSchema = z.object({
  fieldMap: fieldMapSchema,
  priceFormat: priceFormatSchema.default({ decimalSeparator: ".", vatIncluded: true, vatRateBps: 2000, inMinorUnits: false, currency: "TRY" }),
  itemPath: z.string().optional(),
  csvDelimiter: z.string().max(1).optional(),
});

export async function manualImportAction(_prev: SupplierFormState, formData: FormData): Promise<SupplierFormState> {
  const user = await requireAdmin();
  const supplierId = String(formData.get("supplierId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Dosya seçin" };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, message: "Dosya 20 MB'tan büyük olamaz" };

  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, config: true } });
  if (!supplier) return { ok: false, message: "Tedarikçi bulunamadı" };
  const cfg = importConfigSchema.safeParse(supplier.config);
  if (!cfg.success) return { ok: false, message: "Tedarikçi config'inde fieldMap tanımlı olmalı (alan eşlemesi)" };

  const ext = file.name.toLowerCase().split(".").pop();
  let records: unknown[];
  try {
    if (ext === "xlsx") records = await parseXlsx(await file.arrayBuffer());
    else if (ext === "csv" || ext === "txt") records = parseFeedRecords(await file.text(), { format: "csv", csvDelimiter: cfg.data.csvDelimiter });
    else if (ext === "xml") records = parseFeedRecords(await file.text(), { format: "xml", itemPath: cfg.data.itemPath });
    else if (ext === "json") records = parseFeedRecords(await file.text(), { format: "json", itemPath: cfg.data.itemPath });
    else return { ok: false, message: "Desteklenen biçimler: .xlsx, .csv, .xml, .json" };
  } catch (error) {
    return { ok: false, message: `Dosya okunamadı: ${error instanceof Error ? error.message : String(error)}` };
  }

  const { items, errors } = normalizeRecords(records, cfg.data);
  const result = await runManualImport(db, supplier.id, items, errors, { removeMissing: formData.get("removeMissing") === "on", actorId: user.id });
  revalidatePath(`/admin/suppliers/${supplier.id}`);
  revalidatePath("/admin/sync");
  const s = result.stats;
  return {
    ok: result.status !== "FAILED",
    message: `${result.status}: ${s.fetched} satır · ${s.created} yeni · ${s.updated} güncel · ${s.unchanged} değişmedi · ${s.failed} hatalı · ${s.matched} otomatik eşleşti · ${s.review} onay bekliyor`,
  };
}
