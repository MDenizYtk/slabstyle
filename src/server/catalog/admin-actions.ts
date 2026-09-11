"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseTlInput } from "@/lib/money";
import { slugify } from "@/lib/utils";
import { db } from "../db";
import { audit } from "../audit";
import { requireAdmin, requireStaff } from "../auth/dal";
import { redirectWithFlash } from "../admin/flash";
import { recalculateVariants, refreshProductAggregates } from "./recalculate";

const productSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(2).max(300),
  slug: z.string().trim().max(120).optional(),
  shortDesc: z.string().trim().max(500).optional(),
  description: z.string().trim().max(20_000).optional(),
  specs: z.string().max(10_000).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  categoryId: z.string().max(40).optional(),
  brandId: z.string().max(40).optional(),
  isFeatured: z.preprocess((v) => v === "on", z.boolean()),
  seoTitle: z.string().trim().max(160).optional(),
  seoDescription: z.string().trim().max(320).optional(),
});

/** "Hacim: 500 ml" satırlarını teknik özellik listesine çevirir. */
function parseSpecs(text?: string) {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.split(":"))
    .filter((parts) => parts.length >= 2 && parts[0].trim())
    .map(([label, ...rest]) => ({ label: label.trim().slice(0, 80), value: rest.join(":").trim().slice(0, 300) }));
}

export async function updateProductAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  const pid = String(formData.get("id") ?? "");
  if (!parsed.success) redirectWithFlash(`/admin/products/${pid}`, parsed.error.issues[0]?.message ?? "Geçersiz form", "bad");
  const d = parsed.data;
  const slug = slugify(d.slug || d.name);
  const clash = await db.product.findFirst({ where: { slug, NOT: { id: d.id } }, select: { id: true } });
  if (clash) redirectWithFlash(`/admin/products/${d.id}`, "Bu URL (slug) başka bir üründe kullanılıyor", "bad");

  const before = await db.product.findUniqueOrThrow({ where: { id: d.id }, select: { status: true, publishedAt: true } });
  await db.product.update({
    where: { id: d.id },
    data: {
      name: d.name,
      slug,
      shortDesc: d.shortDesc || null,
      description: d.description || null,
      specs: parseSpecs(d.specs),
      status: d.status,
      categoryId: d.categoryId || null,
      brandId: d.brandId || null,
      isFeatured: d.isFeatured,
      seoTitle: d.seoTitle || null,
      seoDescription: d.seoDescription || null,
      publishedAt: d.status === "ACTIVE" && !before.publishedAt ? new Date() : undefined,
    },
  });
  // Arama metni ad/marka/kategoriye bağlı olduğu için yeniden üretilir.
  await refreshProductAggregates(db, [d.id]);
  await audit({ action: "product.updated", actorType: "USER", actorId: user.id, entityType: "Product", entityId: d.id, metadata: { status: d.status } });
  revalidatePath(`/products/${slug}`);
  revalidatePath("/admin/products");
  redirectWithFlash(`/admin/products/${d.id}`, "Ürün kaydedildi");
}

/**
 * Elle fiyat: girilirse fiyat kuralları bu varyant için devre dışı kalır.
 * Boş bırakılırsa kurallara geri dönülür. Yalnızca ADMIN.
 */
export async function setVariantPriceAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const variantId = z.string().min(1).max(40).parse(formData.get("variantId"));
  const productId = String(formData.get("productId") ?? "");
  const manual = parseTlInput(formData.get("manualAmount"));
  const compareAt = parseTlInput(formData.get("compareAtAmount"));
  if (Number.isNaN(manual) || Number.isNaN(compareAt)) redirectWithFlash(`/admin/products/${productId}`, "Fiyat biçimi geçersiz (ör. 1250,90)", "bad");

  const price = await db.price.findUnique({ where: { variantId }, select: { costAmount: true } });
  if (manual != null && price?.costAmount != null && manual < price.costAmount) {
    redirectWithFlash(`/admin/products/${productId}`, "Elle fiyat maliyetin altında olamaz", "bad");
  }

  await db.price.upsert({
    where: { variantId },
    create: { variantId, amount: manual ?? 0, manualAmount: manual, compareAtAmount: compareAt },
    update: { manualAmount: manual, compareAtAmount: compareAt },
  });
  await recalculateVariants(db, [variantId]);
  await audit({ action: "price.manual_set", actorType: "USER", actorId: user.id, entityType: "ProductVariant", entityId: variantId, metadata: { manual, compareAt } });
  redirectWithFlash(`/admin/products/${productId}`, manual == null ? "Fiyat kurallara göre hesaplanıyor" : "Elle fiyat kaydedildi");
}

export async function recalculateProductAction(formData: FormData): Promise<void> {
  await requireStaff();
  const productId = z.string().min(1).max(40).parse(formData.get("productId"));
  const variants = await db.productVariant.findMany({ where: { productId }, select: { id: true } });
  await recalculateVariants(db, variants.map((v) => v.id));
  redirectWithFlash(`/admin/products/${productId}`, "Fiyat ve stok yeniden hesaplandı");
}
