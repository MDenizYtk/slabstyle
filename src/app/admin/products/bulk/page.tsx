import Link from "next/link";
import { BulkPhotoUpload } from "@/components/admin/BulkPhotoUpload";
import { PageHeader } from "@/components/admin/ui";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";

export const metadata = { title: "Toplu fotoğraf yükleme" };

export default async function BulkUploadPage() {
  await requireStaff();
  const [categories, brands] = await Promise.all([
    db.category.findMany({
      orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { position: "asc" }],
      select: { id: true, name: true, parent: { select: { name: true } } },
    }),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <Link href="/admin/products" className="text-sm text-muted hover:text-fg">← Ürünler</Link>
      <PageHeader
        title="Toplu fotoğraf yükleme"
        description="Kategoriyi seç, fotoğrafları topluca yükle. Her fotoğraf için dosya adından isim alan bir ürün oluşur."
        actions={<Link href="/admin/products/new" className="btn-secondary">Tek ürün ekle</Link>}
      />
      <BulkPhotoUpload
        categories={categories.map((c) => ({ id: c.id, name: c.name, parent: c.parent?.name ?? null }))}
        brands={brands}
      />
    </>
  );
}
