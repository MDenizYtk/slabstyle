import Link from "next/link";
import { EmptyRow, Flash, PageHeader } from "@/components/admin/ui";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { readFlash } from "@/server/admin/flash";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";
import {
  acceptCandidateAction,
  createProductFromSupplierAction,
  ignoreSupplierProductAction,
  manualMatchAction,
  rejectCandidateAction,
} from "@/server/matching/admin-actions";

export const metadata = { title: "Ürün eşleştirme" };

export default async function MatchingPage(props: PageProps<"/admin/matching">) {
  await requireStaff();
  const sp = await props.searchParams;
  const tab = sp.tab === "review" ? "review" : "unmatched";
  const flash = readFlash(sp);

  const [reviewCount, unmatchedCount, categories] = await Promise.all([
    db.supplierProduct.count({ where: { matchStatus: "PENDING_REVIEW" } }),
    db.supplierProduct.count({ where: { matchStatus: "UNMATCHED", status: "ACTIVE" } }),
    db.category.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } }),
  ]);

  const items = await db.supplierProduct.findMany({
    where: tab === "review" ? { matchStatus: "PENDING_REVIEW" } : { matchStatus: "UNMATCHED", status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true, supplierSku: true, title: true, brandName: true, gtin: true, mpn: true, costPrice: true, stock: true,
      supplier: { select: { name: true } },
      matchCandidates: {
        where: { status: "PENDING" },
        orderBy: { score: "desc" },
        select: {
          id: true, method: true, score: true,
          variant: { select: { sku: true, gtin: true, mpn: true, name: true, product: { select: { id: true, name: true, brand: { select: { name: true } } } } } },
        },
      },
    },
  });

  return (
    <>
      <PageHeader
        title="Ürün eşleştirme"
        description="Otomatik eşleştirme yalnızca tek ve çelişkisiz barkod veya MPN+marka eşleşmesinde yapılır; diğerleri burada onayınızı bekler."
      />
      <Flash message={flash.message} tone={flash.tone} />
      <div className="mb-4 flex gap-2">
        <Link href="/admin/matching" className={cn("btn", tab === "unmatched" ? "bg-accent text-black" : "btn-secondary")}>Eşleşmemiş ({unmatchedCount})</Link>
        <Link href="/admin/matching?tab=review" className={cn("btn", tab === "review" ? "bg-accent text-black" : "btn-secondary")}>Onay bekleyen ({reviewCount})</Link>
      </div>

      <div className="space-y-3">
        {items.length === 0 && <table className="table-x card"><tbody><EmptyRow colSpan={1} text="Bekleyen kayıt yok" /></tbody></table>}
        {items.map((item) => (
          <article key={item.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs text-subtle">{item.supplier.name} · {item.supplierSku}</p>
                <h2 className="font-semibold">{item.title}</h2>
                <p className="text-xs text-muted">
                  Marka: {item.brandName ?? "—"} · Barkod: {item.gtin ?? "—"} · MPN: {item.mpn ?? "—"} · Alış: {formatMoney(item.costPrice)} · Stok: {item.stock}
                </p>
              </div>
              <form action={ignoreSupplierProductAction}>
                <input type="hidden" name="supplierProductId" value={item.id} />
                <input type="hidden" name="tab" value={tab} />
                <button className="btn-ghost text-xs">Yoksay</button>
              </form>
            </div>

            {item.matchCandidates.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="table-x">
                  <thead><tr><th>Önerilen ürün</th><th>SKU</th><th>Barkod</th><th>Yöntem</th><th>Skor</th><th /></tr></thead>
                  <tbody>
                    {item.matchCandidates.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/admin/products/${c.variant.product.id}`} className="hover:text-accent">{c.variant.product.name}</Link>
                          <span className="text-muted"> · {c.variant.name}</span>
                          <p className="text-xs text-subtle">{c.variant.product.brand?.name}</p>
                        </td>
                        <td className="font-mono text-xs">{c.variant.sku}</td>
                        <td className="font-mono text-xs">{c.variant.gtin ?? "—"}</td>
                        <td className="text-xs">{c.method}</td>
                        <td>{Math.round(c.score * 100)}%</td>
                        <td className="flex gap-2">
                          <form action={acceptCandidateAction}>
                            <input type="hidden" name="candidateId" value={c.id} />
                            <button className="btn-primary text-xs">Bu iki ürünü eşleştir</button>
                          </form>
                          <form action={rejectCandidateAction}>
                            <input type="hidden" name="candidateId" value={c.id} />
                            <button className="btn-ghost text-xs">Reddet</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-3 grid gap-3 border-t border-line pt-3 md:grid-cols-2">
              <form action={manualMatchAction} className="flex gap-2">
                <input type="hidden" name="supplierProductId" value={item.id} />
                <input type="hidden" name="tab" value={tab} />
                <input name="target" placeholder="Bizim varyant SKU'su veya barkod" className="input" aria-label="Eşleştirilecek varyant" />
                <button className="btn-secondary whitespace-nowrap">Elle eşleştir</button>
              </form>
              <form action={createProductFromSupplierAction} className="flex gap-2">
                <input type="hidden" name="supplierProductId" value={item.id} />
                <select name="categoryId" className="input" aria-label="Kategori">
                  <option value="">Kategori seç</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="btn-secondary whitespace-nowrap">Yeni ürün oluştur</button>
              </form>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
