"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizeGtin } from "@/domain/matching/gtin";
import { slugify } from "@/lib/utils";
import { db } from "../db";
import { audit } from "../audit";
import { requireStaff } from "../auth/dal";
import { recalculateVariants } from "../catalog/recalculate";
import { redirectWithFlash } from "../admin/flash";

const id = z.string().min(1).max(40);
const back = (tab?: string) => `/admin/matching${tab ? `?tab=${tab}` : ""}`;

function refresh() {
  revalidatePath("/admin/matching");
  revalidatePath("/admin");
}

async function linkToVariant(supplierProductId: string, variantId: string, actorId: string, via: string) {
  const previous = await db.supplierProduct.findUniqueOrThrow({ where: { id: supplierProductId }, select: { variantId: true } });
  await db.$transaction([
    db.supplierProduct.update({
      where: { id: supplierProductId },
      data: { variantId, matchStatus: "MANUAL_MATCHED", matchMethod: "MANUAL", matchConfidence: 1 },
    }),
    db.productMatchCandidate.updateMany({ where: { supplierProductId, variantId }, data: { status: "ACCEPTED", reviewedById: actorId, reviewedAt: new Date() } }),
    db.productMatchCandidate.updateMany({
      where: { supplierProductId, status: "PENDING", NOT: { variantId } },
      data: { status: "REJECTED", reviewedById: actorId, reviewedAt: new Date() },
    }),
  ]);
  await recalculateVariants(db, [variantId, ...(previous.variantId && previous.variantId !== variantId ? [previous.variantId] : [])]);
  await audit({ action: "product.matched", actorType: "USER", actorId, entityType: "SupplierProduct", entityId: supplierProductId, metadata: { variantId, via } });
}

export async function acceptCandidateAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const candidateId = id.parse(formData.get("candidateId"));
  const c = await db.productMatchCandidate.findUnique({ where: { id: candidateId }, select: { supplierProductId: true, variantId: true } });
  if (!c) redirectWithFlash(back("review"), "Öneri bulunamadı", "bad");
  await linkToVariant(c.supplierProductId, c.variantId, user.id, "candidate");
  refresh();
  redirectWithFlash(back("review"), "Eşleştirildi, fiyat ve stok güncellendi");
}

export async function rejectCandidateAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const candidateId = id.parse(formData.get("candidateId"));
  const c = await db.productMatchCandidate.update({
    where: { id: candidateId },
    data: { status: "REJECTED", reviewedById: user.id, reviewedAt: new Date() },
    select: { supplierProductId: true },
  });
  const remaining = await db.productMatchCandidate.count({ where: { supplierProductId: c.supplierProductId, status: "PENDING" } });
  if (remaining === 0) await db.supplierProduct.update({ where: { id: c.supplierProductId }, data: { matchStatus: "UNMATCHED" } });
  await audit({ action: "product.match_rejected", actorType: "USER", actorId: user.id, entityType: "ProductMatchCandidate", entityId: candidateId });
  refresh();
  redirectWithFlash(back("review"), "Öneri reddedildi");
}

/** "Bu iki ürünü eşleştir": tedarikçi ürünü ↔ bizim varyantımız (SKU veya barkod ile). */
export async function manualMatchAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const supplierProductId = id.parse(formData.get("supplierProductId"));
  const term = String(formData.get("target") ?? "").trim();
  const tab = String(formData.get("tab") ?? "") || undefined;
  if (!term) redirectWithFlash(back(tab), "Varyant SKU'su veya barkod girin", "bad");
  const gtin = normalizeGtin(term);
  const variant = await db.productVariant.findFirst({
    where: { OR: [{ sku: { equals: term, mode: "insensitive" } }, ...(gtin ? [{ gtin: term }, { gtin: gtin.replace(/^0+/, "") }] : [])] },
    select: { id: true, sku: true },
  });
  if (!variant) redirectWithFlash(back(tab), `"${term}" ile varyant bulunamadı`, "bad");
  await linkToVariant(supplierProductId, variant.id, user.id, "manual");
  refresh();
  redirectWithFlash(back(tab), `${variant.sku} ile eşleştirildi`);
}

/** Eşleşecek ürün yoksa tedarikçi ürününden taslak ürün oluşturur. */
export async function createProductFromSupplierAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const supplierProductId = id.parse(formData.get("supplierProductId"));
  const categoryId = String(formData.get("categoryId") ?? "") || null;
  const sp = await db.supplierProduct.findUniqueOrThrow({
    where: { id: supplierProductId },
    select: { id: true, title: true, description: true, brandName: true, gtin: true, mpn: true, imageUrls: true, supplierSku: true },
  });

  const brand = sp.brandName
    ? await db.brand.upsert({ where: { slug: slugify(sp.brandName) }, create: { slug: slugify(sp.brandName), name: sp.brandName }, update: {} })
    : null;
  const baseSlug = slugify(sp.title).slice(0, 80) || "urun";
  const slugTaken = await db.product.count({ where: { slug: { startsWith: baseSlug } } });
  const gtin = normalizeGtin(sp.gtin)?.replace(/^0(?=\d{13}$)/, "") ?? null;
  const gtinFree = gtin ? (await db.productVariant.count({ where: { gtin } })) === 0 : false;

  const product = await db.product.create({
    data: {
      slug: slugTaken ? `${baseSlug}-${slugTaken + 1}` : baseSlug,
      name: sp.title,
      description: sp.description,
      status: "DRAFT",
      brandId: brand?.id,
      categoryId,
      images: { create: sp.imageUrls.slice(0, 8).map((url, position) => ({ url, alt: sp.title, position })) },
      variants: {
        create: {
          sku: `SS-${Date.now().toString(36).toUpperCase()}`,
          gtin: gtinFree ? gtin : null,
          mpn: sp.mpn,
          name: "Standart",
          isDefault: true,
        },
      },
    },
    select: { id: true, variants: { select: { id: true } } },
  });
  await linkToVariant(sp.id, product.variants[0].id, user.id, "create");
  await audit({ action: "product.created_from_supplier", actorType: "USER", actorId: user.id, entityType: "Product", entityId: product.id, metadata: { supplierProductId } });
  refresh();
  redirectWithFlash(`/admin/products/${product.id}`, "Taslak ürün oluşturuldu. Bilgileri kontrol edip yayına alın.");
}

export async function ignoreSupplierProductAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const supplierProductId = id.parse(formData.get("supplierProductId"));
  await db.supplierProduct.update({ where: { id: supplierProductId }, data: { matchStatus: "REJECTED", variantId: null } });
  await db.productMatchCandidate.updateMany({ where: { supplierProductId, status: "PENDING" }, data: { status: "REJECTED" } });
  await audit({ action: "product.match_ignored", actorType: "USER", actorId: user.id, entityType: "SupplierProduct", entityId: supplierProductId });
  refresh();
  redirectWithFlash(back(String(formData.get("tab") ?? "") || undefined), "Yoksayıldı");
}

export async function unmatchAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const supplierProductId = id.parse(formData.get("supplierProductId"));
  const productId = String(formData.get("productId") ?? "");
  const sp = await db.supplierProduct.update({
    where: { id: supplierProductId },
    data: { variantId: null, matchStatus: "UNMATCHED", matchMethod: null, matchConfidence: null },
    select: { id: true },
  });
  const old = formData.get("variantId");
  if (typeof old === "string" && old) await recalculateVariants(db, [old]);
  await audit({ action: "product.unmatched", actorType: "USER", actorId: user.id, entityType: "SupplierProduct", entityId: sp.id });
  refresh();
  redirectWithFlash(productId ? `/admin/products/${productId}` : back(), "Eşleşme kaldırıldı");
}
