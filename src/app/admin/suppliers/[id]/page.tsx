import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { EmptyRow, PageHeader } from "@/components/admin/ui";
import { CredentialsForm, ImportForm, SupplierForm, TestConnectionForm } from "@/components/admin/SupplierForms";
import { Pagination } from "@/components/store/Pagination";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SYNC_STATUS_LABEL } from "@/domain/orders/status";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";
import { decodeCredentials, listAdapters } from "@/server/suppliers/registry";
import { triggerSyncAction } from "@/server/sync/admin-actions";

export const metadata = { title: "Tedarikçi" };
const PAGE_SIZE = 50;

export default async function SupplierDetailPage(props: PageProps<"/admin/suppliers/[id]">) {
  const user = await requireStaff();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const supplier = await db.supplier.findUnique({ where: { id } });
  if (!supplier) notFound();

  const productWhere: Prisma.SupplierProductWhereInput = {
    supplierId: id,
    ...(q ? { OR: [{ supplierSku: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { gtin: q }] } : {}),
  };
  const [products, total, jobs, statusCounts] = await Promise.all([
    db.supplierProduct.findMany({
      where: productWhere,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, supplierSku: true, title: true, gtin: true, costPrice: true, stock: true, status: true, matchStatus: true, lastSeenAt: true,
        variant: { select: { sku: true, product: { select: { id: true, name: true } } } },
      },
    }),
    db.supplierProduct.count({ where: productWhere }),
    db.syncJob.findMany({ where: { supplierId: id }, orderBy: { queuedAt: "desc" }, take: 10, select: { id: true, type: true, status: true, queuedAt: true, errorMessage: true } }),
    db.supplierProduct.groupBy({ by: ["matchStatus"], where: { supplierId: id }, _count: { _all: true } }),
  ]);

  const adapters = listAdapters();
  const credentialFields = adapters.find((a) => a.key === supplier.adapterKey)?.credentialFields ?? [];
  const storedKeys = user.role === "ADMIN" ? Object.keys(decodeCredentials(supplier.credentialsEncrypted)) : [];
  const hrefFor = (p: number) => `/admin/suppliers/${id}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <Link href="/admin/suppliers" className="text-sm text-muted hover:text-fg">← Tedarikçiler</Link>
      <PageHeader
        title={supplier.name}
        description={`${supplier.code} · ${supplier.integrationType} · adapter: ${supplier.adapterKey}`}
        actions={
          <>
            <form action={triggerSyncAction}>
              <input type="hidden" name="supplierId" value={id} />
              <input type="hidden" name="type" value="STOCK_PRICE" />
              <button className="btn-secondary">Stok/fiyat sync</button>
            </form>
            <form action={triggerSyncAction}>
              <input type="hidden" name="supplierId" value={id} />
              <input type="hidden" name="type" value="CATALOG" />
              <button className="btn-primary">Katalog sync</button>
            </form>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <StatusBadge status={supplier.status} />
        {statusCounts.map((s) => (
          <span key={s.matchStatus} className="badge bg-panel-2 text-muted">{s.matchStatus}: {s._count._all}</span>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {user.role === "ADMIN" && (
            <SupplierForm
              adapters={adapters}
              initial={{
                id: supplier.id, code: supplier.code, name: supplier.name, status: supplier.status, integrationType: supplier.integrationType,
                adapterKey: supplier.adapterKey, priority: supplier.priority, defaultLeadTimeDays: supplier.defaultLeadTimeDays,
                safetyStock: supplier.safetyStock, stockSyncIntervalMin: supplier.stockSyncIntervalMin,
                catalogSyncIntervalMin: supplier.catalogSyncIntervalMin, autoSubmitOrders: supplier.autoSubmitOrders,
                notes: supplier.notes ?? "", config: JSON.stringify(supplier.config, null, 2),
              }}
            />
          )}
        </div>
        <div className="space-y-6">
          <TestConnectionForm supplierId={id} />
          {user.role === "ADMIN" && <CredentialsForm supplierId={id} fields={credentialFields} storedKeys={storedKeys} />}
          {user.role === "ADMIN" && <ImportForm supplierId={id} />}
          <section className="card overflow-x-auto">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Son senkronizasyonlar</h2>
            <table className="table-x">
              <tbody>
                {jobs.length === 0 && <EmptyRow colSpan={3} text="Henüz iş yok" />}
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="text-xs">{j.type}</td>
                    <td><StatusBadge status={j.status} label={SYNC_STATUS_LABEL[j.status]} />{j.errorMessage && <p className="mt-1 text-xs text-bad">{j.errorMessage}</p>}</td>
                    <td className="text-right text-xs text-subtle">{j.queuedAt.toLocaleString("tr-TR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="slab text-xl">Tedarikçi ürünleri ({total})</h2>
          <form className="flex gap-2">
            <input name="q" defaultValue={q} placeholder="SKU, ad, barkod" className="input max-w-xs" />
            <button className="btn-secondary">Ara</button>
          </form>
        </div>
        <div className="card overflow-x-auto">
          <table className="table-x">
            <thead>
              <tr><th>Tedarikçi SKU</th><th>Başlık</th><th>Barkod</th><th className="text-right">Alış</th><th className="text-right">Stok</th><th>Durum</th><th>Eşleşme</th><th>Bizim ürün</th></tr>
            </thead>
            <tbody>
              {products.length === 0 && <EmptyRow colSpan={8} />}
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-xs">{p.supplierSku}</td>
                  <td className="max-w-xs truncate">{p.title}</td>
                  <td className="font-mono text-xs text-muted">{p.gtin ?? "—"}</td>
                  <td className="text-right">{formatMoney(p.costPrice)}</td>
                  <td className="text-right">{p.stock}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td><StatusBadge status={p.matchStatus} /></td>
                  <td>{p.variant ? <Link href={`/admin/products/${p.variant.product.id}`} className="text-accent">{p.variant.sku}</Link> : <Link href="/admin/matching" className="text-xs text-warn">Eşleştir</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageCount={Math.ceil(total / PAGE_SIZE)} hrefFor={hrefFor} />
      </section>
    </>
  );
}
