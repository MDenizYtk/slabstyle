import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { ProductCreateForm } from "@/components/admin/ProductCreateForm";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";

export const metadata = { title: "Yeni ürün" };

export default async function NewProductPage() {
  await requireStaff();
  const [categories, brands] = await Promise.all([
    db.category.findMany({ orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { position: "asc" }], select: { id: true, name: true, parent: { select: { name: true } } } }),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <Link href="/admin/products" className="text-sm text-muted hover:text-fg">← Ürünler</Link>
      <PageHeader title="Yeni ürün" description="Fotoğraf yükleyin, kategori seçin, ürün kodlarını ve fiyatları girin." actions={<Link href="/admin/categories" className="btn-ghost">Kategorileri yönet</Link>} />
      <ProductCreateForm categories={categories.map((c) => ({ id: c.id, name: c.name, parent: c.parent?.name ?? null }))} brands={brands} />
    </>
  );
}
