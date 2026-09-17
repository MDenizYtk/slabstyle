import { slugify } from "@/lib/utils";
import { db } from "../db";

/** Aynı isimde ürün varsa sonuna sayı ekleyerek benzersiz URL üretir. */
export async function uniqueProductSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name).slice(0, 90) || "urun";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await db.product.findFirst({ where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Formdaki marka seçimi; "yeni marka" yazıldıysa markayı oluşturur. */
export async function resolveBrandId(formData: FormData): Promise<string | null> {
  const newBrand = String(formData.get("newBrand") ?? "").trim().slice(0, 80);
  if (newBrand) {
    const slug = slugify(newBrand);
    const brand = await db.brand.upsert({ where: { slug }, create: { slug, name: newBrand }, update: {}, select: { id: true } });
    return brand.id;
  }
  return String(formData.get("brandId") ?? "") || null;
}
