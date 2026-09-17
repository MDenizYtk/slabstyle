"use server";

import { revalidatePath } from "next/cache";
import { groupKeyFromFilename, groupNameFromFilename, productNameFromFilename } from "@/domain/catalog/filename";
import { parseTlInput } from "@/lib/money";
import { slugify } from "@/lib/utils";
import { db } from "../db";
import { audit } from "../audit";
import { redirectWithFlash } from "../admin/flash";
import { requireStaff } from "../auth/dal";
import { randomToken } from "../security/crypto";
import { deleteMedia, saveImage, UploadError } from "../storage";
import { refreshProductAggregates } from "./recalculate";
import { resolveBrandId, uniqueProductSlug } from "./product-helpers";

/**
 * Toplu fotoğraf yükleme: her fotoğraf (ya da aynı isimli fotoğraf grubu) için
 * bir taslak ürün oluşturur. İstemci dosyaları gruplara böler ve bu action'ı
 * sırayla çağırır; tarayıcı/istek boyut sınırına takılmadan yüzlerce fotoğraf
 * yüklenebilir.
 */
export type BulkResult = { created: number; updated: number; photos: number; errors: string[] };

const MAX_FILES_PER_BATCH = 40;
const MAX_BATCH_BYTES = 25 * 1024 * 1024;

/**
 * Ürün listesindeki hızlı düzenleme ve toplu işlemler.
 *  op = "save"    : satırlarda değişen isim ve fiyatları kaydeder
 *  op = "publish" / "draft" / "archive" : seçili ürünlerin durumunu değiştirir
 *  op = "delete"  : seçili ürünleri siler (yalnızca ADMIN)
 */
export async function bulkProductsAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const op = String(formData.get("op") ?? "");
  const back = `/admin/products${String(formData.get("query") ?? "")}`;
  const ids = formData.getAll("selected").map(String).filter((v) => /^[a-z0-9]+$/i.test(v));

  if (op === "save") {
    let changed = 0;
    const rows = await db.product.findMany({
      where: { id: { in: formData.getAll("rowId").map(String) } },
      select: { id: true, name: true, slug: true, variants: { orderBy: { position: "asc" }, take: 1, select: { id: true, price: { select: { amount: true, manualAmount: true } } } } },
    });
    for (const row of rows) {
      const newName = String(formData.get(`name:${row.id}`) ?? "").trim();
      const priceInput = formData.get(`price:${row.id}`);
      const newPrice = parseTlInput(priceInput);
      if (Number.isNaN(newPrice)) {
        redirectWithFlash(back, `"${row.name}" için fiyat biçimi geçersiz (ör. 1250,90)`, "bad");
      }
      if (newName && newName !== row.name) {
        await db.product.update({ where: { id: row.id }, data: { name: newName.slice(0, 300) } });
        await refreshProductAggregates(db, [row.id]);
        changed++;
      }
      const variant = row.variants[0];
      if (variant && newPrice !== (variant.price?.manualAmount ?? null)) {
        await db.price.upsert({
          where: { variantId: variant.id },
          create: { variantId: variant.id, amount: newPrice ?? 0, manualAmount: newPrice },
          update: { manualAmount: newPrice, ...(newPrice !== null ? { amount: newPrice } : {}) },
        });
        await refreshProductAggregates(db, [row.id]);
        changed++;
      }
    }
    revalidatePath("/", "layout");
    redirectWithFlash(back, changed ? `${changed} değişiklik kaydedildi` : "Değişiklik yok");
  }

  if (ids.length === 0) redirectWithFlash(back, "Önce ürün seçin", "bad");

  if (op === "delete") {
    if (user.role !== "ADMIN") redirectWithFlash(back, "Silme yetkisi yalnızca ADMIN kullanıcıdadır", "bad");
    const products = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, images: { select: { url: true } }, variants: { select: { id: true } } } });
    const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
    await db.$transaction([
      db.supplierProduct.updateMany({ where: { variantId: { in: variantIds } }, data: { variantId: null, matchStatus: "UNMATCHED", matchMethod: null, matchConfidence: null } }),
      db.product.deleteMany({ where: { id: { in: ids } } }),
    ]);
    await Promise.all(products.flatMap((p) => p.images.map((i) => deleteMedia(i.url))));
    await audit({ action: "product.bulk_deleted", actorType: "USER", actorId: user.id, metadata: { count: ids.length } });
    revalidatePath("/", "layout");
    redirectWithFlash(back, `${ids.length} ürün silindi`);
  }

  const status = op === "publish" ? "ACTIVE" : op === "draft" ? "DRAFT" : op === "archive" ? "ARCHIVED" : null;
  if (!status) redirectWithFlash(back, "Geçersiz işlem", "bad");
  await db.product.updateMany({
    where: { id: { in: ids } },
    data: { status, ...(status === "ACTIVE" ? { publishedAt: new Date() } : {}) },
  });
  await audit({ action: "product.bulk_status", actorType: "USER", actorId: user.id, metadata: { count: ids.length, status } });
  revalidatePath("/", "layout");
  redirectWithFlash(back, `${ids.length} ürün ${status === "ACTIVE" ? "yayına alındı" : status === "DRAFT" ? "taslağa alındı" : "arşivlendi"}`);
}

export async function bulkCreateProductsAction(formData: FormData): Promise<BulkResult> {
  const user = await requireStaff();
  const result: BulkResult = { created: 0, updated: 0, photos: 0, errors: [] };

  const categoryId = String(formData.get("categoryId") ?? "");
  const status = formData.get("status") === "ACTIVE" ? "ACTIVE" : "DRAFT";
  const groupByName = formData.get("groupByName") === "on";
  const files = formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);

  if (!categoryId || !(await db.category.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
    result.errors.push("Kategori seçilmedi");
    return result;
  }
  if (files.length === 0) return result;
  if (files.length > MAX_FILES_PER_BATCH) {
    result.errors.push(`Tek seferde en fazla ${MAX_FILES_PER_BATCH} fotoğraf gönderilebilir`);
    return result;
  }
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_BATCH_BYTES) {
    result.errors.push("Bu grup 25 MB sınırını aşıyor");
    return result;
  }

  const brandId = await resolveBrandId(formData);

  // Dosyaları ürünlere göre grupla (gruplama kapalıysa her fotoğraf ayrı ürün).
  const groups = new Map<string, { name: string; files: File[] }>();
  files.forEach((file, index) => {
    const key = groupByName ? groupKeyFromFilename(file.name) : `tek-${index}`;
    const name = groupByName ? groupNameFromFilename(file.name) : productNameFromFilename(file.name);
    const group = groups.get(key) ?? { name, files: [] };
    group.files.push(file);
    groups.set(key, group);
  });

  for (const group of groups.values()) {
    const folder = `products/${slugify(group.name).slice(0, 40) || "urun"}`;
    const urls: string[] = [];
    try {
      for (const file of group.files) urls.push(await saveImage(file, folder));
    } catch (error) {
      await Promise.all(urls.map(deleteMedia));
      result.errors.push(error instanceof UploadError ? error.message : `${group.name}: fotoğraf yüklenemedi`);
      continue;
    }

    try {
      // Gruplama açıkken aynı ad + kategori zaten varsa (önceki gruptan) fotoğraflar eklenir.
      const existing = groupByName
        ? await db.product.findFirst({ where: { name: group.name, categoryId }, select: { id: true, _count: { select: { images: true } } } })
        : null;

      if (existing) {
        await db.productImage.createMany({
          data: urls.map((url, i) => ({ productId: existing.id, url, alt: group.name, position: existing._count.images + i })),
        });
        result.updated++;
      } else {
        const product = await db.product.create({
          data: {
            name: group.name,
            slug: await uniqueProductSlug(group.name),
            categoryId,
            brandId,
            status,
            publishedAt: status === "ACTIVE" ? new Date() : null,
            images: { create: urls.map((url, i) => ({ url, alt: group.name, position: i })) },
            variants: { create: { sku: `SS-${randomToken(5).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`, name: "Standart", isDefault: true } },
          },
          select: { id: true },
        });
        await refreshProductAggregates(db, [product.id]);
        result.created++;
      }
      result.photos += urls.length;
    } catch (error) {
      await Promise.all(urls.map(deleteMedia));
      result.errors.push(`${group.name}: kaydedilemedi (${error instanceof Error ? error.message.slice(0, 120) : "bilinmeyen hata"})`);
    }
  }

  await audit({
    action: "product.bulk_created",
    actorType: "USER",
    actorId: user.id,
    entityType: "Category",
    entityId: categoryId,
    metadata: { created: result.created, updated: result.updated, photos: result.photos },
  });
  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
  return result;
}
