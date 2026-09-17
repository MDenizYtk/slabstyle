"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isValidGtin } from "@/domain/matching/gtin";
import { parseTlInput } from "@/lib/money";
import { slugify } from "@/lib/utils";
import { db } from "../db";
import { audit } from "../audit";
import { requireAdmin, requireStaff } from "../auth/dal";
import { redirectWithFlash } from "../admin/flash";
import { deleteMedia, MAX_IMAGES_PER_UPLOAD, saveImage, UploadError } from "../storage";
import { recalculateVariants, refreshProductAggregates } from "./recalculate";
import { OWN_STOCK_CODE, setOwnStock } from "./own-stock";

export type ProductFormState = { error?: string; fieldErrors?: Record<string, string> };

const SKU_RE = /^[A-Za-z0-9._-]{2,64}$/;
const MAX_TOTAL_UPLOAD = 25 * 1024 * 1024;

function imageFiles(formData: FormData, field = "images"): File[] {
  return formData.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
}

async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name).slice(0, 90) || "urun";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await db.product.findFirst({ where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function resolveBrand(formData: FormData): Promise<string | null> {
  const newBrand = String(formData.get("newBrand") ?? "").trim().slice(0, 80);
  if (newBrand) {
    const slug = slugify(newBrand);
    const brand = await db.brand.upsert({ where: { slug }, create: { slug, name: newBrand }, update: {}, select: { id: true } });
    return brand.id;
  }
  return String(formData.get("brandId") ?? "") || null;
}

type VariantRow = { name: string; sku: string; gtin: string | null; mpn: string | null; price: number | null; compareAt: number | null; cost: number | null; stock: number | null };

/** Formdaki varyant satırlarını (aynı sıradaki alan dizileri) okur ve doğrular. */
async function readVariants(formData: FormData): Promise<{ rows: VariantRow[]; error?: string }> {
  const col = (k: string) => formData.getAll(k).map((v) => String(v).trim());
  const names = col("variantName");
  const skus = col("variantSku");
  const gtins = col("variantGtin");
  const mpns = col("variantMpn");
  const prices = col("variantPrice");
  const compares = col("variantCompareAt");
  const costs = col("variantCost");
  const stocks = col("variantStock");

  const rows: VariantRow[] = [];
  for (let i = 0; i < names.length; i++) {
    const n = i + 1;
    if (!names[i] && !skus[i] && !prices[i]) continue; // tamamen boş satır
    const sku = skus[i] || `SS-${Date.now().toString(36).toUpperCase()}${i}`;
    if (!SKU_RE.test(sku)) return { rows, error: `${n}. varyant: ürün kodu yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir (2-64)` };
    const gtin = gtins[i] || null;
    if (gtin && !isValidGtin(gtin)) return { rows, error: `${n}. varyant: barkod geçersiz (kontrol hanesi tutmuyor)` };
    const price = parseTlInput(prices[i]);
    const compareAt = parseTlInput(compares[i]);
    const cost = parseTlInput(costs[i]);
    const stock = stocks[i] === "" || stocks[i] === undefined ? null : Number(stocks[i]);
    if ([price, compareAt, cost].some((v) => Number.isNaN(v))) return { rows, error: `${n}. varyant: tutar biçimi geçersiz (ör. 1250,90)` };
    if (stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000)) return { rows, error: `${n}. varyant: stok 0 veya pozitif tam sayı olmalı` };
    if (stock !== null && cost === null && price === null) return { rows, error: `${n}. varyant: stok girildiyse maliyet veya satış fiyatı da girilmeli` };
    if (price !== null && cost !== null && price < cost) return { rows, error: `${n}. varyant: satış fiyatı maliyetin altında` };
    rows.push({ name: names[i] || "Standart", sku, gtin, mpn: mpns[i] || null, price, compareAt, cost, stock });
  }
  if (rows.length === 0) return { rows, error: "En az bir varyant (ürün kodu ve/veya fiyat) girin" };

  const skuSet = new Set(rows.map((r) => r.sku.toLowerCase()));
  if (skuSet.size !== rows.length) return { rows, error: "Aynı ürün kodu birden fazla varyantta kullanılamaz" };
  const clashes = await db.productVariant.findMany({
    where: { OR: [{ sku: { in: rows.map((r) => r.sku), mode: "insensitive" } }, { gtin: { in: rows.map((r) => r.gtin).filter((g): g is string => !!g) } }] },
    select: { sku: true, gtin: true },
  });
  if (clashes.length) return { rows, error: `Bu ürün kodu/barkod başka bir üründe kullanılıyor: ${clashes.map((c) => c.sku).join(", ")}` };
  return { rows };
}

async function applyVariantCommercials(variantId: string, row: Pick<VariantRow, "price" | "compareAt" | "cost" | "stock">) {
  if (row.price !== null || row.compareAt !== null) {
    await db.price.upsert({
      where: { variantId },
      create: { variantId, amount: row.price ?? 0, manualAmount: row.price, compareAtAmount: row.compareAt },
      update: { manualAmount: row.price, compareAtAmount: row.compareAt, ...(row.price !== null ? { amount: row.price } : {}) },
    });
  }
  if (row.stock !== null) await setOwnStock(db, variantId, { cost: row.cost ?? row.price ?? 0, stock: row.stock });
}

/** Admin: sıfırdan ürün ekleme (fotoğraf, kategori, ürün kodları, fiyat, kendi stok). */
export async function createProductAction(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const user = await requireStaff();
  const name = String(formData.get("name") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "");
  if (name.length < 2) return { fieldErrors: { name: "Ürün adı gerekli" } };
  if (!categoryId || !(await db.category.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
    return { fieldErrors: { categoryId: "Kategori seçin" } };
  }

  const files = imageFiles(formData);
  if (files.length > MAX_IMAGES_PER_UPLOAD) return { fieldErrors: { images: `En fazla ${MAX_IMAGES_PER_UPLOAD} fotoğraf` } };
  if (files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_UPLOAD) return { fieldErrors: { images: "Fotoğrafların toplamı 25 MB'ı geçemez" } };

  const { rows, error } = await readVariants(formData);
  if (error) return { error };

  const folder = `products/${slugify(name).slice(0, 40) || "urun"}`;
  const urls: string[] = [];
  try {
    for (const f of files) urls.push(await saveImage(f, folder));
  } catch (e) {
    await Promise.all(urls.map(deleteMedia));
    return { fieldErrors: { images: e instanceof UploadError ? e.message : "Fotoğraf yüklenemedi" } };
  }

  const status = formData.get("status") === "ACTIVE" ? "ACTIVE" : "DRAFT";
  let product: { id: string; variants: { id: string; sku: string }[] };
  try {
    product = await db.product.create({
      data: {
        name: name.slice(0, 300),
        slug: await uniqueSlug(name),
        categoryId,
        brandId: await resolveBrand(formData),
        shortDesc: String(formData.get("shortDesc") ?? "").trim().slice(0, 500) || null,
        description: String(formData.get("description") ?? "").trim().slice(0, 20_000) || null,
        specs: String(formData.get("specs") ?? "")
          .split(/\r?\n/)
          .map((l) => l.split(":"))
          .filter((p) => p.length >= 2 && p[0].trim())
          .map(([label, ...rest]) => ({ label: label.trim().slice(0, 80), value: rest.join(":").trim().slice(0, 300) })),
        status,
        isFeatured: formData.get("isFeatured") === "on",
        publishedAt: status === "ACTIVE" ? new Date() : null,
        images: { create: urls.map((url, position) => ({ url, alt: name, position })) },
        variants: {
          create: rows.map((r, i) => ({ name: r.name, sku: r.sku, gtin: r.gtin, mpn: r.mpn, options: r.name !== "Standart" ? { Seçenek: r.name } : {}, isDefault: i === 0, position: i })),
        },
      },
      select: { id: true, variants: { select: { id: true, sku: true } } },
    });
  } catch (e) {
    await Promise.all(urls.map(deleteMedia));
    throw e;
  }

  const bySku = new Map(product.variants.map((v) => [v.sku, v.id]));
  for (const row of rows) await applyVariantCommercials(bySku.get(row.sku)!, row);
  await recalculateVariants(db, product.variants.map((v) => v.id));
  await refreshProductAggregates(db, [product.id]);

  await audit({ action: "product.created", actorType: "USER", actorId: user.id, entityType: "Product", entityId: product.id, metadata: { variants: rows.length, images: urls.length } });
  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
  redirect(`/admin/products/${product.id}?flash=${encodeURIComponent("Ürün eklendi")}&tone=ok`);
}

const idSchema = z.string().min(1).max(40);

export async function addImagesAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const productId = idSchema.parse(formData.get("productId"));
  const files = imageFiles(formData);
  const back = `/admin/products/${productId}`;
  if (files.length === 0) redirectWithFlash(back, "Fotoğraf seçin", "bad");
  const count = await db.productImage.count({ where: { productId } });
  if (count + files.length > 30) redirectWithFlash(back, "Bir üründe en fazla 30 fotoğraf olabilir", "bad");
  if (files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_UPLOAD) redirectWithFlash(back, "Toplam 25 MB sınırı aşıldı", "bad");

  const product = await db.product.findUniqueOrThrow({ where: { id: productId }, select: { name: true, slug: true } });
  const urls: string[] = [];
  try {
    for (const f of files) urls.push(await saveImage(f, `products/${product.slug.slice(0, 40)}`));
  } catch (e) {
    await Promise.all(urls.map(deleteMedia));
    redirectWithFlash(back, e instanceof UploadError ? e.message : "Fotoğraf yüklenemedi", "bad");
  }
  await db.productImage.createMany({ data: urls.map((url, i) => ({ productId, url, alt: product.name, position: count + i })) });
  await audit({ action: "product.images_added", actorType: "USER", actorId: user.id, entityType: "Product", entityId: productId, metadata: { count: urls.length } });
  revalidatePath(`/products/${product.slug}`);
  redirectWithFlash(back, `${urls.length} fotoğraf eklendi`);
}

export async function deleteImageAction(formData: FormData): Promise<void> {
  await requireStaff();
  const imageId = idSchema.parse(formData.get("imageId"));
  const image = await db.productImage.delete({ where: { id: imageId }, select: { url: true, productId: true, product: { select: { slug: true } } } });
  await deleteMedia(image.url);
  revalidatePath(`/products/${image.product.slug}`);
  redirectWithFlash(`/admin/products/${image.productId}`, "Fotoğraf silindi");
}

/** Seçilen fotoğrafı ana görsel (ilk sıra) yapar. */
export async function makePrimaryImageAction(formData: FormData): Promise<void> {
  await requireStaff();
  const imageId = idSchema.parse(formData.get("imageId"));
  const image = await db.productImage.findUniqueOrThrow({ where: { id: imageId }, select: { productId: true } });
  const all = await db.productImage.findMany({ where: { productId: image.productId }, orderBy: { position: "asc" }, select: { id: true } });
  const ordered = [imageId, ...all.map((i) => i.id).filter((id) => id !== imageId)];
  await db.$transaction(ordered.map((id, position) => db.productImage.update({ where: { id }, data: { position } })));
  redirectWithFlash(`/admin/products/${image.productId}`, "Ana fotoğraf güncellendi");
}

export async function addVariantAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const productId = idSchema.parse(formData.get("productId"));
  const back = `/admin/products/${productId}`;
  const { rows, error } = await readVariants(formData);
  if (error) redirectWithFlash(back, error, "bad");
  const position = await db.productVariant.count({ where: { productId } });
  for (const [i, r] of rows.entries()) {
    const v = await db.productVariant.create({
      data: { productId, name: r.name, sku: r.sku, gtin: r.gtin, mpn: r.mpn, options: { Seçenek: r.name }, position: position + i, isDefault: position === 0 && i === 0 },
      select: { id: true },
    });
    await applyVariantCommercials(v.id, r);
    await recalculateVariants(db, [v.id]);
  }
  await audit({ action: "product.variant_added", actorType: "USER", actorId: user.id, entityType: "Product", entityId: productId });
  redirectWithFlash(back, "Varyant eklendi");
}

const variantUpdateSchema = z.object({
  variantId: idSchema,
  productId: idSchema,
  name: z.string().trim().min(1).max(100),
  sku: z.string().trim().regex(SKU_RE, "Ürün kodu geçersiz"),
  gtin: z.string().trim().max(14).optional(),
  mpn: z.string().trim().max(80).optional(),
  isActive: z.preprocess((v) => v === "on", z.boolean()),
});

export async function updateVariantAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const parsed = variantUpdateSchema.safeParse(Object.fromEntries(formData));
  const back = `/admin/products/${String(formData.get("productId") ?? "")}`;
  if (!parsed.success) redirectWithFlash(back, parsed.error.issues[0]?.message ?? "Geçersiz", "bad");
  const d = parsed.data;
  if (d.gtin && !isValidGtin(d.gtin)) redirectWithFlash(back, "Barkod geçersiz", "bad");
  const clash = await db.productVariant.findFirst({
    where: { NOT: { id: d.variantId }, OR: [{ sku: { equals: d.sku, mode: "insensitive" } }, ...(d.gtin ? [{ gtin: d.gtin }] : [])] },
    select: { sku: true },
  });
  if (clash) redirectWithFlash(back, `Ürün kodu/barkod başka varyantta kullanılıyor (${clash.sku})`, "bad");
  await db.productVariant.update({ where: { id: d.variantId }, data: { name: d.name, sku: d.sku, gtin: d.gtin || null, mpn: d.mpn || null, isActive: d.isActive } });
  await recalculateVariants(db, [d.variantId]);
  await audit({ action: "product.variant_updated", actorType: "USER", actorId: user.id, entityType: "ProductVariant", entityId: d.variantId });
  redirectWithFlash(`/admin/products/${d.productId}`, "Varyant kaydedildi");
}

/**
 * Ürünü tamamen siler. Geçmiş siparişler etkilenmez (sipariş satırları ürün adı ve
 * fiyatının kopyasını tutar). Tedarikçi teklifleri eşleştirme ekranına
 * "eşleşmemiş" olarak döner; kendi stok kayıtları ve yüklenen fotoğraflar silinir.
 */
export async function deleteProductAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const productId = idSchema.parse(formData.get("productId"));
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, slug: true, images: { select: { url: true } }, variants: { select: { id: true } } },
  });
  if (!product) redirectWithFlash("/admin/products", "Ürün bulunamadı", "bad");

  const variantIds = product.variants.map((v) => v.id);
  const ownStock = await db.supplier.findUnique({ where: { code: OWN_STOCK_CODE }, select: { id: true } });

  await db.$transaction([
    ...(ownStock ? [db.supplierProduct.deleteMany({ where: { supplierId: ownStock.id, variantId: { in: variantIds } } })] : []),
    db.supplierProduct.updateMany({
      where: { variantId: { in: variantIds } },
      data: { variantId: null, matchStatus: "UNMATCHED", matchMethod: null, matchConfidence: null },
    }),
    db.product.delete({ where: { id: productId } }),
  ]);
  await Promise.all(product.images.map((img) => deleteMedia(img.url)));

  await audit({ action: "product.deleted", actorType: "USER", actorId: user.id, entityType: "Product", entityId: productId, metadata: { name: product.name } });
  revalidatePath("/", "layout");
  revalidatePath("/admin/products");
  redirectWithFlash("/admin/products", `"${product.name}" silindi`);
}

/** Kendi stoğum: maliyet ve adet. */
export async function setOwnStockAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const variantId = idSchema.parse(formData.get("variantId"));
  const productId = String(formData.get("productId") ?? "");
  const back = `/admin/products/${productId}`;
  const cost = parseTlInput(formData.get("cost"));
  const stock = Number(formData.get("stock"));
  if (cost === null || Number.isNaN(cost)) redirectWithFlash(back, "Maliyet girin (ör. 250,00)", "bad");
  if (!Number.isInteger(stock) || stock < 0) redirectWithFlash(back, "Stok 0 veya pozitif tam sayı olmalı", "bad");
  await setOwnStock(db, variantId, { cost, stock });
  await recalculateVariants(db, [variantId]);
  await audit({ action: "stock.own_updated", actorType: "USER", actorId: user.id, entityType: "ProductVariant", entityId: variantId, metadata: { cost, stock } });
  redirectWithFlash(back, "Kendi stoğun güncellendi");
}
