import Link from "next/link";
import type { OrderStatus, Prisma } from "@/generated/prisma/client";
import { EmptyRow, PageHeader } from "@/components/admin/ui";
import { Pagination } from "@/components/store/Pagination";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/domain/orders/status";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";

export const metadata = { title: "Siparişler" };
const PAGE_SIZE = 50;

export default async function AdminOrdersPage(props: PageProps<"/admin/orders">) {
  await requireStaff();
  const sp = await props.searchParams;
  const status = typeof sp.status === "string" && sp.status in ORDER_STATUS_LABEL ? (sp.status as OrderStatus) : undefined;
  const attention = sp.attention === "1";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.OrderWhereInput = {
    ...(status ? { status } : {}),
    ...(attention ? { supplierOrders: { some: { status: { in: ["AWAITING_MANUAL", "FAILED", "REJECTED"] } } } } : {}),
    ...(q ? (/^\d+$/.test(q) ? { number: Number(q) } : { email: { contains: q, mode: "insensitive" } }) : {}),
  };

  const [total, orders] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        status: true,
        email: true,
        grandTotal: true,
        subtotal: true,
        costTotal: true,
        createdAt: true,
        user: { select: { name: true } },
        payments: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { supplierOrders: true } },
      },
    }),
  ]);

  const qs = (p: number) => {
    const s = new URLSearchParams();
    if (status) s.set("status", status);
    if (attention) s.set("attention", "1");
    if (q) s.set("q", q);
    if (p > 1) s.set("page", String(p));
    return `/admin/orders${s.size ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Siparişler" description={`${total} sipariş`} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Sipariş no veya e-posta" className="input max-w-xs" />
        <select name="status" defaultValue={status ?? ""} className="input max-w-52">
          <option value="">Tüm durumlar</option>
          {Object.entries(ORDER_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="attention" value="1" defaultChecked={attention} className="accent-accent" /> Müdahale gerekenler
        </label>
        <button className="btn-primary">Filtrele</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table-x">
          <thead>
            <tr><th>No</th><th>Müşteri</th><th>Tarih</th><th>Durum</th><th>Ödeme</th><th>Paket</th><th className="text-right">Tutar</th><th className="text-right">Tahmini kâr</th></tr>
          </thead>
          <tbody>
            {orders.length === 0 && <EmptyRow colSpan={8} />}
            {orders.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/admin/orders/${o.id}`} className="font-semibold text-accent">#{o.number}</Link></td>
                <td>{o.user.name}<p className="text-xs text-subtle">{o.email}</p></td>
                <td className="text-xs text-muted">{o.createdAt.toLocaleString("tr-TR")}</td>
                <td><StatusBadge status={o.status} label={ORDER_STATUS_LABEL[o.status]} /></td>
                <td>{o.payments[0] ? <StatusBadge status={o.payments[0].status} label={PAYMENT_STATUS_LABEL[o.payments[0].status]} /> : "—"}</td>
                <td>{o._count.supplierOrders}</td>
                <td className="text-right">{formatMoney(o.grandTotal)}</td>
                <td className="text-right text-ok">{formatMoney(o.subtotal - o.costTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={Math.ceil(total / PAGE_SIZE)} hrefFor={qs} />
    </>
  );
}
