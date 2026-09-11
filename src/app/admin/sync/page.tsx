import type { Prisma, SyncJobStatus } from "@/generated/prisma/client";
import { EmptyRow, PageHeader } from "@/components/admin/ui";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SYNC_STATUS_LABEL } from "@/domain/orders/status";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";
import { retrySyncJobAction, triggerSyncAction } from "@/server/sync/admin-actions";

export const metadata = { title: "Senkronizasyon" };

function Stats({ value }: { value: Prisma.JsonValue }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return <span className="text-subtle">—</span>;
  const entries = Object.entries(value).filter(([, v]) => typeof v === "number" && v > 0);
  if (!entries.length) return <span className="text-subtle">değişiklik yok</span>;
  return <span className="text-xs text-muted">{entries.map(([k, v]) => `${k}: ${v}`).join(" · ")}</span>;
}

export default async function AdminSyncPage(props: PageProps<"/admin/sync">) {
  await requireStaff();
  const sp = await props.searchParams;
  const status = typeof sp.status === "string" && sp.status in SYNC_STATUS_LABEL ? (sp.status as SyncJobStatus) : undefined;

  const [jobs, suppliers] = await Promise.all([
    db.syncJob.findMany({
      where: status ? { status } : {},
      orderBy: { queuedAt: "desc" },
      take: 100,
      select: {
        id: true, type: true, status: true, trigger: true, stats: true, errorMessage: true, attempt: true,
        queuedAt: true, startedAt: true, finishedAt: true, supplier: { select: { name: true } },
      },
    }),
    db.supplier.findMany({
      where: { status: { not: "DISABLED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, lastStockSyncAt: true, lastCatalogSyncAt: true, stockSyncIntervalMin: true, catalogSyncIntervalMin: true },
    }),
  ]);

  return (
    <>
      <PageHeader title="Senkronizasyon" description="Stok/fiyat ve katalog işleri arka planda (BullMQ) çalışır. Başarısız işler mevcut veriyi silmez." />

      <section className="mb-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {suppliers.map((s) => (
          <div key={s.id} className="card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{s.name}</p>
              <StatusBadge status={s.status} />
            </div>
            <dl className="space-y-1 text-xs text-muted">
              <div className="flex justify-between"><dt>Stok/fiyat (her {s.stockSyncIntervalMin} dk)</dt><dd>{s.lastStockSyncAt?.toLocaleString("tr-TR") ?? "—"}</dd></div>
              <div className="flex justify-between"><dt>Katalog (her {s.catalogSyncIntervalMin} dk)</dt><dd>{s.lastCatalogSyncAt?.toLocaleString("tr-TR") ?? "—"}</dd></div>
            </dl>
            <div className="flex gap-2">
              <form action={triggerSyncAction}>
                <input type="hidden" name="supplierId" value={s.id} />
                <input type="hidden" name="type" value="STOCK_PRICE" />
                <button className="btn-secondary text-xs">Stok/fiyat çalıştır</button>
              </form>
              <form action={triggerSyncAction}>
                <input type="hidden" name="supplierId" value={s.id} />
                <input type="hidden" name="type" value="CATALOG" />
                <button className="btn-secondary text-xs">Katalog çalıştır</button>
              </form>
            </div>
          </div>
        ))}
      </section>

      <form className="mb-4 flex gap-2">
        <select name="status" defaultValue={status ?? ""} className="input max-w-52">
          <option value="">Tüm işler</option>
          {Object.entries(SYNC_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn-primary">Filtrele</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="table-x">
          <thead>
            <tr><th>Tedarikçi</th><th>Tür</th><th>Tetik</th><th>Durum</th><th>Sonuç</th><th>Süre</th><th>Zaman</th><th /></tr>
          </thead>
          <tbody>
            {jobs.length === 0 && <EmptyRow colSpan={8} text="Henüz iş yok" />}
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.supplier.name}</td>
                <td className="text-muted">{j.type}</td>
                <td className="text-xs text-muted">{j.trigger}{j.attempt > 1 ? ` #${j.attempt}` : ""}</td>
                <td><StatusBadge status={j.status} label={SYNC_STATUS_LABEL[j.status]} /></td>
                <td className="max-w-md">
                  {j.errorMessage ? <span className="text-xs text-bad">{j.errorMessage}</span> : <Stats value={j.stats} />}
                </td>
                <td className="text-xs text-muted">
                  {j.startedAt && j.finishedAt ? `${((j.finishedAt.getTime() - j.startedAt.getTime()) / 1000).toFixed(1)} sn` : "—"}
                </td>
                <td className="text-xs text-subtle">{j.queuedAt.toLocaleString("tr-TR")}</td>
                <td>
                  {(j.status === "FAILED" || j.status === "PARTIAL") && (
                    <form action={retrySyncJobAction}>
                      <input type="hidden" name="jobId" value={j.id} />
                      <button className="btn-ghost text-xs">Tekrar çalıştır</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
