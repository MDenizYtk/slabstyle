"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { slugify } from "@/lib/utils";
import { db } from "../db";
import { audit } from "../audit";
import { requireStaff } from "../auth/dal";
import { redirectWithFlash } from "../admin/flash";
import { refreshProductAggregates } from "./recalculate";

const BACK = "/admin/categories";

const schema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(2, "Kategori adı gerekli").max(80),
  parentId: z.string().max(40).optional(),
  description: z.string().trim().max(500).optional(),
  position: z.coerce.number().int().min(0).max(1000).default(0),
  isVisible: z.preprocess((v) => v === "on", z.boolean()),
});

export async function saveCategoryAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirectWithFlash(BACK, parsed.error.issues[0]?.message ?? "Geçersiz", "bad");
  const d = parsed.data;
  if (d.id && d.parentId === d.id) redirectWithFlash(BACK, "Kategori kendi alt kategorisi olamaz", "bad");

  const slug = slugify(d.name);
  const clash = await db.category.findFirst({ where: { slug, ...(d.id ? { NOT: { id: d.id } } : {}) }, select: { id: true } });
  if (clash) redirectWithFlash(BACK, "Bu isimde kategori var", "bad");

  const data = { name: d.name, slug, parentId: d.parentId || null, description: d.description || null, position: d.position, isVisible: d.isVisible };
  const saved = d.id ? await db.category.update({ where: { id: d.id }, data }) : await db.category.create({ data });
  await audit({ action: d.id ? "category.updated" : "category.created", actorType: "USER", actorId: user.id, entityType: "Category", entityId: saved.id });
  revalidatePath("/", "layout");
  redirectWithFlash(BACK, "Kategori kaydedildi");
}

/**
 * Kategoriyi siler. Ürünler silinmez, kategorisiz kalır (onDelete: SetNull);
 * alt kategoriler ana kategoriye dönüşür. Kategoriye özel fiyat kuralları silinir.
 */
export async function deleteCategoryAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const id = z.string().min(1).max(40).parse(formData.get("id"));
  const category = await db.category.findUnique({ where: { id }, select: { name: true } });
  if (!category) redirectWithFlash(BACK, "Kategori bulunamadı", "bad");

  const products = await db.product.findMany({ where: { categoryId: id }, select: { id: true } });
  const children = await db.category.count({ where: { parentId: id } });
  await db.category.delete({ where: { id } });
  // Arama metni kategori adını içerdiği için etkilenen ürünlerde yenilenir.
  if (products.length) await refreshProductAggregates(db, products.map((p) => p.id));

  await audit({
    action: "category.deleted",
    actorType: "USER",
    actorId: user.id,
    entityType: "Category",
    entityId: id,
    metadata: { name: category.name, products: products.length, children },
  });
  revalidatePath("/", "layout");
  const details = [products.length ? `${products.length} ürün kategorisiz kaldı` : "", children ? `${children} alt kategori ana kategori oldu` : ""].filter(Boolean).join(", ");
  redirectWithFlash(BACK, `"${category.name}" silindi${details ? `. ${details}.` : ""}`);
}
