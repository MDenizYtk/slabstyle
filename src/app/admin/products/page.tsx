import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { DeleteProductButton } from "@/components/admin/DeleteProductButton";
import { EmptyRow, Flash, PageHeader } from "@/components/admin/ui";
import { isShop } from "@/config/mode";
import { Pagination } from "@/components/store/Pagination";
import { ProductImage } from "@/components/store/ProductImage";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatMoney } from "@/lib/money";
import { readFlash } from "@/server/admin/flash";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";

export const metadata = { title: "Ürünler" };
const PAGE_SIZE = 50;
const STATUS_LABEL = { ACTIVE: "Yayında", DRAFT: "Taslak", ARCHIVED: "Arşiv" } as const;

export default async function AdminProductsPage(props: PageProps<"/admin/products">) {
  const user = await requireStaff();
  const sp = await props.searchParams;
  const flash = readFlash(sp);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const status = typeof sp.status === "string" && ["DRAFT", "ACTIVE", "ARCHIVED"].includes(sp.status) ? (sp.status as "DRAFT" | "ACTIVE" | "ARCHIVED") : undefined;
  const stockOut = sp.stock === "out";
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.ProductWhereInput = {
    ...(status ? { status } : {}),
    ...(stockOut ? { totalAvailable: 0 } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { variants: { some: { OR: [{ sku: { contains: q, mode: "insensitive" } }, { gtin: q }] } } },
          ],
        }
      : {}),
  };

  const [total, products] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        minPrice: true,
        totalAvailable: true,
        brand: { select: { name: true } },
        category: { select: { name: true } },
        images: { select: { url: true }, orderBy: { position: "asc" }, take: 1 },
        _count: { select: { variants: true, images: true } },
        variants: { select: { _count: { select: { supplierProducts: true } } } },
      },
    }),
  ]);

  const qs = (p: number) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (status) s.set("status", status);
    if (stockOut) s.set("stock", "out");
    if (p > 1) s.set("page", String(p));
    return `/admin/products${s.size ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Ürünler"
        description={`${total} ürün · düzenlemek, fotoğraf eklemek veya silmek için ürüne tıklayın`}
        actions={
          <>
            {isShop && <Link href="/admin/matching" className="btn-secondary">Ürün eşleştirme</Link>}
            <Link href="/admin/products/new" className="btn-primary">Yeni ürün</Link>
          </>
        }
      />
      <Flash message={flash.message} tone={flash.tone} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Ad, SKU veya barkod" className="input max-w-xs" />
        <select name="status" defaultValue={status ?? ""} className="input max-w-40">
          <option value="">Tüm durumlar</option>
          <option value="ACTIVE">Yayında</option>
          <option value="DRAFT">Taslak</option>
          <option value="ARCHIVED">Arşiv</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="stock" value="out" defaultChecked={stockOut} className="accent-accent" /> Stoksuz
        </label>
        <button className="btn-primary">Filtrele</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="table-x">
          <thead>
            <tr>
              <th className="w-16" />
              <th>Ürün</th><th>Marka</th><th>Kategori</th><th>Varyant</th>
              {isShop && <><th>Teklif</th><th className="text-right">Stok</th></>}
              <th className="text-right">Fiyat</th><th>Durum</th><th className="text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && <EmptyRow colSpan={isShop ? 10 : 8} />}
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/admin/products/${p.id}`} className="relative block h-12 w-12 overflow-hidden rounded-md bg-panel-2" aria-label={`${p.name} düzenle`}>
                    <ProductImage src={p.images[0]?.url ?? null} alt={p.name} sizes="48px" />
                  </Link>
                </td>
                <td>
                  <Link href={`/admin/products/${p.id}`} className="font-semibold text-fg hover:text-accent hover:underline">{p.name}</Link>
                  <p className="text-xs text-subtle">{p._count.images} fotoğraf</p>
                </td>
                <td className="text-muted">{p.brand?.name ?? "—"}</td>
                <td className="text-muted">{p.category?.name ?? <span className="text-warn">Kategorisiz</span>}</td>
                <td>{p._count.variants}</td>
                {isShop && (
                  <>
                    <td>{p.variants.reduce((n, v) => n + v._count.supplierProducts, 0)}</td>
                    <td className={`text-right ${p.totalAvailable === 0 ? "text-bad" : ""}`}>{p.totalAvailable}</td>
                  </>
                )}
                <td className="text-right whitespace-nowrap">{p.minPrice != null ? formatMoney(p.minPrice) : "—"}</td>
                <td><StatusBadge status={p.status} label={STATUS_LABEL[p.status]} /></td>
                <td>
                  <div className="flex justify-end gap-2">
                    <Link href={`/admin/products/${p.id}`} className="btn-secondary text-xs">Düzenle</Link>
                    {user.role === "ADMIN" && <DeleteProductButton productId={p.id} name={p.name} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={Math.ceil(total / PAGE_SIZE)} hrefFor={qs} />
    </>
  );
}
