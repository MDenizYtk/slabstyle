import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ORDER_STATUS_LABEL } from "@/domain/orders/status";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/auth/dal";
import { getUserOrders } from "@/server/orders/customer-queries";

export const metadata: Metadata = { title: "Siparişlerim", robots: { index: false } };

export default async function OrdersPage() {
  const user = await requireUser("/account/orders");
  const orders = await getUserOrders(user.id);

  return (
    <div className="container-x py-10">
      <Link href="/account" className="text-sm text-muted hover:text-fg">← Hesabım</Link>
      <h1 className="slab mb-8 mt-2 text-4xl">Siparişlerim</h1>
      {orders.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-muted">Henüz siparişin yok.</p>
          <Link href="/products" className="btn-primary mt-6">Alışverişe başla</Link>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-x">
            <thead>
              <tr><th>Sipariş</th><th>Tarih</th><th>Ürün</th><th>Durum</th><th className="text-right">Tutar</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/account/orders/${o.id}`} className="font-semibold text-accent hover:underline">#{o.number}</Link></td>
                  <td className="text-muted">{o.createdAt.toLocaleDateString("tr-TR")}</td>
                  <td className="text-muted">{o._count.items}</td>
                  <td><StatusBadge status={o.status} label={ORDER_STATUS_LABEL[o.status]} /></td>
                  <td className="text-right font-semibold">{formatMoney(o.grandTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
