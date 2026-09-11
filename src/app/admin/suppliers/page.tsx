import Link from "next/link";
import { EmptyRow, PageHeader } from "@/components/admin/ui";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";

export const metadata = { title: "Tedarikçiler" };

export default async function AdminSuppliersPage() {
  const user = await requireStaff();
  const suppliers = await db.supplier.findMany({
    orderBy: [{ priority: "desc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      integrationType: true,
      adapterKey: true,
      priority: true,
      autoSubmitOrders: true,
      lastStockSyncAt: true,
      lastCatalogSyncAt: true,
      _count: { select: { products: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Tedarikçiler"
        description="Tedarikçi adları yalnızca admin panelinde görünür; müşteriye asla gösterilmez."
        actions={user.role === "ADMIN" ? <Link href="/admin/suppliers/new" className="btn-primary">Tedarikçi ekle</Link> : undefined}
      />
      <div className="card overflow-x-auto">
        <table className="table-x">
          <thead>
            <tr><th>Tedarikçi</th><th>Entegrasyon</th><th>Öncelik</th><th>Ürün</th><th>Sipariş gönderimi</th><th>Son stok sync</th><th>Son katalog sync</th><th>Durum</th></tr>
          </thead>
          <tbody>
            {suppliers.length === 0 && <EmptyRow colSpan={8} />}
            {suppliers.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/admin/suppliers/${s.id}`} className="font-semibold hover:text-accent">{s.name}</Link>
                  <p className="text-xs text-subtle">{s.code}</p>
                </td>
                <td className="text-muted">{s.integrationType} · {s.adapterKey}</td>
                <td>{s.priority}</td>
                <td>{s._count.products}</td>
                <td className="text-muted">{s.autoSubmitOrders ? "Otomatik" : "Manuel"}</td>
                <td className="text-xs text-muted">{s.lastStockSyncAt?.toLocaleString("tr-TR") ?? "—"}</td>
                <td className="text-xs text-muted">{s.lastCatalogSyncAt?.toLocaleString("tr-TR") ?? "—"}</td>
                <td><StatusBadge status={s.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
