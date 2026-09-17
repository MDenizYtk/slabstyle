import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { ProductBulkBar, SelectAllCheckbox } from "@/components/admin/ProductBulkBar";
import { EmptyRow, Flash, PageHeader } from "@/components/admin/ui";
import { Pagination } from "@/components/store/Pagination";
import { ProductImage } from "@/components/store/ProductImage";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { isShop } from "@/config/mode";
import { formatMoney } from "@/lib/money";
import { readFlash } from "@/server/admin/flash";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";

export const metadata = { title: "Ürünler" };
const PAGE_SIZE = 50;
const STATUS_LABEL = { ACTIVE: "Yayında", DRAFT: "Taslak", ARCHIVED: "Arşiv" } as const;
const tl = (minor: number | null | undefined) => (minor == null ? "" : (minor / 100).toFixed(2).replace(".", ","));

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
        variants: {
          orderBy: { position: "asc" },
          select: { _count: { select: { supplierProducts: true } }, price: { select: { manualAmount: true, amount: true } } },
        },
      },
    }),
  ]);

  const queryString = (p: number) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (status) s.set("status", status);
    if (stockOut) s.set("stock", "out");
    if (p > 1) s.set("page", String(p));
    return s.size ? `?${s}` : "";
  };

  return (
    <>
      <PageHeader
        title="Ürünler"
        description={`${total} ürün · isim ve fiyatı listede düzenleyebilir, seçtiklerine toplu işlem uygulayabilirsin`}
        actions={
          <>
            {isShop && <Link href="/admin/matching" className="btn-secondary">Ürün eşleştirme</Link>}
            <Link href="/admin/products/bulk" className="btn-secondary">Toplu fotoğraf yükle</Link>
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
        {isShop && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="stock" value="out" defaultChecked={stockOut} className="accent-accent" /> Stoksuz
          </label>
        )}
        <button className="btn-primary">Filtrele</button>
      </form>

      <form>
        <input type="hidden" name="query" value={queryString(page)} />
        <ProductBulkBar canDelete={user.role === "ADMIN"} />

        <div className="card overflow-x-auto">
          <table className="table-x">
            <thead>
              <tr>
                <th className="w-8"><SelectAllCheckbox /></th>
                <th className="w-16" />
                <th>Ürün adı</th><th>Marka</th><th>Kategori</th>
                {isShop && <><th>Teklif</th><th className="text-right">Stok</th></>}
                <th className="w-32 text-right">Fiyat (TL)</th><th>Durum</th><th className="text-right">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 && <EmptyRow colSpan={isShop ? 10 : 8} />}
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input type="checkbox" name="selected" value={p.id} className="accent-accent" aria-label={`${p.name} seç`} />
                    <input type="hidden" name="rowId" value={p.id} />
                  </td>
                  <td>
                    <Link href={`/admin/products/${p.id}`} className="relative block h-12 w-12 overflow-hidden rounded-md bg-panel-2" aria-label={`${p.name} düzenle`}>
                      <ProductImage src={p.images[0]?.url ?? null} alt={p.name} sizes="48px" />
                    </Link>
                  </td>
                  <td className="min-w-64">
                    <input name={`name:${p.id}`} defaultValue={p.name} className="input" aria-label="Ürün adı" />
                    <p className="mt-1 text-xs text-subtle">
                      {p._count.images} fotoğraf · <Link href={`/admin/products/${p.id}`} className="text-accent hover:underline">detay</Link>
                    </p>
                  </td>
                  <td className="text-muted">{p.brand?.name ?? "—"}</td>
                  <td className="text-muted">{p.category?.name ?? <span className="text-warn">Kategorisiz</span>}</td>
                  {isShop && (
                    <>
                      <td>{p.variants.reduce((n, v) => n + v._count.supplierProducts, 0)}</td>
                      <td className={`text-right ${p.totalAvailable === 0 ? "text-bad" : ""}`}>{p.totalAvailable}</td>
                    </>
                  )}
                  <td>
                    <input
                      name={`price:${p.id}`}
                      defaultValue={tl(p.variants[0]?.price?.manualAmount)}
                      placeholder={p.minPrice != null ? formatMoney(p.minPrice) : "—"}
                      inputMode="decimal"
                      className="input text-right"
                      aria-label="Fiyat"
                    />
                  </td>
                  <td><StatusBadge status={p.status} label={STATUS_LABEL[p.status]} /></td>
                  <td>
                    {/* Tekil silme ürün detayında; burada iç içe form olmaması için yalnızca düzenleme var. */}
                    <div className="flex justify-end gap-2">
                      <Link href={`/admin/products/${p.id}`} className="btn-secondary text-xs">Düzenle</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
      <Pagination page={page} pageCount={Math.ceil(total / PAGE_SIZE)} hrefFor={(p) => `/admin/products${queryString(p)}`} />
    </>
  );
}
