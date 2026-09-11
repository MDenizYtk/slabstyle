import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ORDER_STATUS_LABEL, PACKAGE_STATUS_LABEL, RETURN_STATUS_LABEL, SHIPMENT_STATUS_LABEL } from "@/domain/orders/status";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/auth/dal";
import { getUserOrder } from "@/server/orders/customer-queries";
import { ReturnRequestForm } from "@/components/store/ReturnRequestForm";

export const metadata: Metadata = { title: "Sipariş detayı", robots: { index: false } };

type Address = { fullName?: string; phone?: string; line1?: string; line2?: string; district?: string; city?: string };

export default async function OrderDetailPage(props: PageProps<"/account/orders/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/account/orders/${id}`);
  const order = await getUserOrder(user.id, id);
  if (!order) notFound();

  const address = (order.shippingAddress ?? {}) as Address;
  const packages = order.supplierOrders.filter((so) => so.items.length > 0);
  const returnableItems = ["DELIVERED", "SHIPPED", "PARTIALLY_SHIPPED"].includes(order.status)
    ? packages.flatMap((p) => p.items)
    : [];

  return (
    <div className="container-x py-10">
      <Link href="/account/orders" className="text-sm text-muted hover:text-fg">← Siparişlerim</Link>
      <div className="mb-8 mt-2 flex flex-wrap items-center gap-4">
        <h1 className="slab text-4xl">Sipariş #{order.number}</h1>
        <StatusBadge status={order.status} label={ORDER_STATUS_LABEL[order.status]} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          {order.status === "PENDING_PAYMENT" && (
            <div className="card border-warn/40 p-4 text-sm text-warn">Ödemen henüz onaylanmadı. Onaylandığında siparişin hazırlanmaya başlar.</div>
          )}

          {packages.map((pkg, i) => (
            <section key={pkg.id} className="card p-5" aria-label={`Paket ${i + 1}`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Paket {i + 1}</h2>
                <StatusBadge status={pkg.status} label={PACKAGE_STATUS_LABEL[pkg.status]} />
              </div>
              <ul className="divide-y divide-line text-sm">
                {pkg.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-3 py-2">
                    <span>{item.productName} <span className="text-muted">· {item.variantName} × {item.quantity}</span></span>
                    <span className="font-medium">{formatMoney(item.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              {pkg.shipments.map((s) => (
                <div key={s.trackingNumber} className="mt-3 rounded-lg bg-panel-2 p-3 text-sm">
                  <p className="font-semibold">{s.carrier} · {SHIPMENT_STATUS_LABEL[s.status]}</p>
                  <p className="text-muted">
                    Takip no: {s.trackingUrl ? (
                      <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{s.trackingNumber}</a>
                    ) : s.trackingNumber}
                  </p>
                  {s.deliveredAt && <p className="text-muted">Teslim: {s.deliveredAt.toLocaleString("tr-TR")}</p>}
                </div>
              ))}
            </section>
          ))}

          {order.items.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">Ürünler</h2>
              <ul className="divide-y divide-line text-sm">
                {order.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-3 py-2">
                    <span>{item.productName} <span className="text-muted">· {item.variantName} × {item.quantity}</span></span>
                    <span className="font-medium">{formatMoney(item.lineTotal)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {order.returns.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">İade talepleri</h2>
              <ul className="space-y-2 text-sm">
                {order.returns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between">
                    <span className="text-muted">{r.createdAt.toLocaleDateString("tr-TR")} · {r.reason}</span>
                    <StatusBadge status={r.status} label={RETURN_STATUS_LABEL[r.status]} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {returnableItems.length > 0 && (
            <ReturnRequestForm orderId={order.id} items={returnableItems.map((i) => ({ id: i.id, label: `${i.productName} · ${i.variantName}`, maxQty: i.quantity }))} />
          )}
        </div>

        <aside className="space-y-4">
          <section className="card p-5 text-sm">
            <h2 className="mb-3 font-semibold">Özet</h2>
            <dl className="space-y-2">
              <div className="flex justify-between"><dt className="text-muted">Ara toplam</dt><dd>{formatMoney(order.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Kargo</dt><dd>{order.shippingTotal === 0 ? "Ücretsiz" : formatMoney(order.shippingTotal)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 font-bold"><dt>Toplam</dt><dd>{formatMoney(order.grandTotal)}</dd></div>
            </dl>
          </section>
          <section className="card p-5 text-sm">
            <h2 className="mb-3 font-semibold">Teslimat adresi</h2>
            <p>{address.fullName}</p>
            <p className="text-muted">{address.line1} {address.line2}</p>
            <p className="text-muted">{address.district} / {address.city}</p>
            <p className="text-muted">{address.phone}</p>
          </section>
          <p className="text-xs text-subtle">Sipariş tarihi: {order.createdAt.toLocaleString("tr-TR")}</p>
        </aside>
      </div>
    </div>
  );
}
