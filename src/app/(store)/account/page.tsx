import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isShop } from "@/config/mode";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ORDER_STATUS_LABEL } from "@/domain/orders/status";
import { formatMoney } from "@/lib/money";
import { logoutAction } from "@/server/auth/actions";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db";
import { getUserOrders } from "@/server/orders/customer-queries";

export const metadata: Metadata = { title: "Hesabım", robots: { index: false } };

export default async function AccountPage() {
  if (!isShop) notFound(); // vitrin modunda müşteri hesabı kapalı
  const user = await requireUser("/account");
  const [orders, addresses] = await Promise.all([
    getUserOrders(user.id),
    db.address.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
  ]);

  return (
    <div className="container-x py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Hoş geldin</p>
          <h1 className="slab text-4xl">{user.name}</h1>
          <p className="text-sm text-subtle">{user.email}</p>
        </div>
        <form action={logoutAction}>
          <button className="btn-secondary">Çıkış yap</button>
        </form>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <section className="card p-6" aria-labelledby="recent-orders">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="recent-orders" className="slab text-xl">Son siparişler</h2>
            <Link href="/account/orders" className="text-sm text-accent hover:underline">Tümü</Link>
          </div>
          {orders.length === 0 ? (
            <p className="text-sm text-muted">Henüz siparişin yok.</p>
          ) : (
            <ul className="divide-y divide-line">
              {orders.slice(0, 5).map((o) => (
                <li key={o.id}>
                  <Link href={`/account/orders/${o.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-accent">
                    <span className="font-semibold">#{o.number}</span>
                    <span className="text-sm text-muted">{o.createdAt.toLocaleDateString("tr-TR")}</span>
                    <StatusBadge status={o.status} label={ORDER_STATUS_LABEL[o.status]} />
                    <span className="font-semibold">{formatMoney(o.grandTotal)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-6" aria-labelledby="addresses">
          <h2 id="addresses" className="slab mb-4 text-xl">Adreslerim</h2>
          {addresses.length === 0 ? (
            <p className="text-sm text-muted">Kayıtlı adres yok. İlk siparişte adres ekleyebilirsin.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {addresses.map((a) => (
                <li key={a.id} className="rounded-lg border border-line p-3">
                  <p className="font-semibold">
                    {a.title} {a.isDefault && <span className="badge ml-1 bg-accent/15 text-accent">Varsayılan</span>}
                  </p>
                  <p className="text-muted">{a.fullName} · {a.phone}</p>
                  <p className="text-muted">{a.line1} {a.line2}</p>
                  <p className="text-muted">{a.district} / {a.city}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
