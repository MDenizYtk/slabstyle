import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, PageHeader } from "@/components/admin/ui";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, RETURN_STATUS_LABEL, SHIPMENT_STATUS_LABEL, SUPPLIER_ORDER_STATUS_LABEL } from "@/domain/orders/status";
import { formatMoney } from "@/lib/money";
import { readFlash } from "@/server/admin/flash";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";
import {
  addShipmentAction,
  cancelOrderAction,
  markManualSubmittedAction,
  pollNowAction,
  reallocateAction,
  retrySubmitAction,
} from "@/server/orders/admin-actions";

export const metadata = { title: "Sipariş" };

type Address = { fullName?: string; phone?: string; line1?: string; line2?: string; district?: string; city?: string; postalCode?: string };

export default async function AdminOrderPage(props: PageProps<"/admin/orders/[id]">) {
  const user = await requireStaff();
  const { id } = await props.params;
  const flash = readFlash(await props.searchParams);

  const order = await db.order.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, email: true } },
      items: { where: { supplierOrderId: null } },
      supplierOrders: {
        orderBy: { createdAt: "asc" },
        include: {
          supplier: { select: { name: true, code: true } },
          items: { include: { supplierProduct: { select: { supplierSku: true } } } },
          shipments: { orderBy: { createdAt: "asc" } },
        },
      },
      payments: { orderBy: { createdAt: "desc" }, include: { refunds: { orderBy: { createdAt: "desc" } } } },
      returns: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, reason: true, createdAt: true } },
    },
  });
  if (!order) notFound();

  const logs = await db.auditLog.findMany({
    where: { entityId: { in: [order.id, ...order.supplierOrders.map((s) => s.id), ...order.payments.map((p) => p.id)] } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, action: true, actorType: true, createdAt: true },
  });
  const address = order.shippingAddress as Address;
  const profit = order.subtotal - order.costTotal;
  const canCancel = user.role === "ADMIN" && !["CANCELLED", "REFUNDED"].includes(order.status) && !order.supplierOrders.some((s) => s.status === "SHIPPED" || s.status === "DELIVERED");

  return (
    <>
      <Link href="/admin/orders" className="text-sm text-muted hover:text-fg">← Siparişler</Link>
      <PageHeader
        title={`Sipariş #${order.number}`}
        description={`${order.user.name} · ${order.email} · ${order.createdAt.toLocaleString("tr-TR")}`}
        actions={<StatusBadge status={order.status} label={ORDER_STATUS_LABEL[order.status]} />}
      />
      <Flash message={flash.message} tone={flash.tone} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4"><p className="label">Toplam</p><p className="text-xl font-bold">{formatMoney(order.grandTotal)}</p></div>
        <div className="card p-4"><p className="label">Tedarikçi maliyeti</p><p className="text-xl font-bold">{formatMoney(order.costTotal)}</p></div>
        <div className="card p-4"><p className="label">Tahmini kâr</p><p className="text-xl font-bold text-ok">{formatMoney(profit)}</p></div>
        <div className="card p-4"><p className="label">Kargo</p><p className="text-xl font-bold">{order.shippingTotal === 0 ? "Ücretsiz" : formatMoney(order.shippingTotal)}</p></div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          {order.items.length > 0 && (
            <section className="card border-bad/40 p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-bad">Tedarikçi atanamayan ürünler</h2>
                <form action={reallocateAction}>
                  <input type="hidden" name="orderId" value={order.id} />
                  <button className="btn-secondary text-xs">Tedarikçi atamayı tekrar dene</button>
                </form>
              </div>
              <ul className="mt-2 text-sm">
                {order.items.map((i) => <li key={i.id}>{i.productName} · {i.variantName} × {i.quantity}</li>)}
              </ul>
              {order.status === "PENDING_PAYMENT" && <p className="mt-2 text-xs text-muted">Ödeme onaylanınca tedarikçi ataması otomatik yapılır.</p>}
            </section>
          )}

          {order.supplierOrders.map((so) => (
            <section key={so.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{so.supplier.name}</h2>
                  <p className="text-xs text-muted">
                    {so.dispatchMode === "AUTO" ? "Otomatik gönderim" : "Manuel gönderim"} · Dış sipariş no: {so.externalOrderId ?? "—"} · Deneme: {so.attemptCount}
                  </p>
                </div>
                <StatusBadge status={so.status} label={SUPPLIER_ORDER_STATUS_LABEL[so.status]} />
              </div>
              {so.lastError && <p className="mt-2 rounded bg-bad/10 p-2 text-xs text-bad">{so.lastError}</p>}

              <table className="table-x mt-3">
                <thead><tr><th>Ürün</th><th>Tedarikçi SKU</th><th className="text-right">Adet</th><th className="text-right">Satış</th><th className="text-right">Maliyet</th></tr></thead>
                <tbody>
                  {so.items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.productName} <span className="text-muted">· {i.variantName}</span></td>
                      <td className="font-mono text-xs">{i.supplierProduct?.supplierSku ?? "—"}</td>
                      <td className="text-right">{i.quantity}</td>
                      <td className="text-right">{formatMoney(i.lineTotal)}</td>
                      <td className="text-right text-muted">{formatMoney(i.unitCost * i.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {so.shipments.map((s) => (
                <p key={s.id} className="mt-2 text-sm">
                  {s.carrier} · <span className="font-mono">{s.trackingNumber}</span> · {SHIPMENT_STATUS_LABEL[s.status]}
                  {s.trackingUrl && <> · <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-accent">takip</a></>}
                </p>
              ))}

              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                {["AWAITING_MANUAL", "FAILED", "PENDING"].includes(so.status) && (
                  <>
                    <form action={markManualSubmittedAction} className="flex gap-2">
                      <input type="hidden" name="supplierOrderId" value={so.id} />
                      <input name="externalOrderId" placeholder="Tedarikçi sipariş no" className="input w-48 text-xs" aria-label="Tedarikçi sipariş numarası" />
                      <button className="btn-secondary text-xs">Tedarikçiye verildi</button>
                    </form>
                    <form action={retrySubmitAction}>
                      <input type="hidden" name="supplierOrderId" value={so.id} />
                      <button className="btn-ghost text-xs">API ile gönder / tekrar dene</button>
                    </form>
                  </>
                )}
                {["SUBMITTED", "ACCEPTED", "SHIPPED"].includes(so.status) && so.externalOrderId && (
                  <form action={pollNowAction}>
                    <input type="hidden" name="supplierOrderId" value={so.id} />
                    <button className="btn-ghost text-xs">Tedarikçiden durum sorgula</button>
                  </form>
                )}
              </div>
              {!["CANCELLED", "REJECTED", "DELIVERED"].includes(so.status) && (
                <form action={addShipmentAction} className="mt-3 grid gap-2 sm:grid-cols-5">
                  <input type="hidden" name="supplierOrderId" value={so.id} />
                  <input name="carrier" placeholder="Kargo firması" className="input text-xs" required aria-label="Kargo firması" />
                  <input name="trackingNumber" placeholder="Takip no" className="input text-xs" required aria-label="Takip numarası" />
                  <input name="trackingUrl" placeholder="https://takip adresi" className="input text-xs" aria-label="Takip adresi" />
                  <select name="status" defaultValue="IN_TRANSIT" className="input text-xs" aria-label="Kargo durumu">
                    {Object.entries(SHIPMENT_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <button className="btn-secondary text-xs">Kargo ekle</button>
                </form>
              )}
            </section>
          ))}
        </div>

        <div className="space-y-4">
          <section className="card p-4 text-sm">
            <h2 className="mb-2 font-semibold">Teslimat adresi</h2>
            <p>{address.fullName} · {address.phone}</p>
            <p className="text-muted">{address.line1} {address.line2}</p>
            <p className="text-muted">{address.district} / {address.city} {address.postalCode}</p>
            {order.customerNote && <p className="mt-2 rounded bg-panel-2 p-2 text-xs">Not: {order.customerNote}</p>}
          </section>

          <section className="card p-4 text-sm">
            <h2 className="mb-2 font-semibold">Ödemeler</h2>
            {order.payments.length === 0 && <p className="text-muted">Ödeme yok</p>}
            {order.payments.map((p) => (
              <div key={p.id} className="border-b border-line py-2 last:border-0">
                <div className="flex justify-between"><span>{p.provider} · {formatMoney(p.amount)}</span><StatusBadge status={p.status} label={PAYMENT_STATUS_LABEL[p.status]} /></div>
                {p.failureReason && <p className="text-xs text-bad">{p.failureReason}</p>}
                {p.refunds.map((r) => <p key={r.id} className="text-xs text-muted">İade {formatMoney(r.amount)} · {r.status} · {r.reason}</p>)}
              </div>
            ))}
          </section>

          {order.returns.length > 0 && (
            <section className="card p-4 text-sm">
              <h2 className="mb-2 font-semibold">İadeler</h2>
              {order.returns.map((r) => (
                <p key={r.id} className="flex justify-between"><Link href="/admin/returns" className="text-accent">{r.reason}</Link><StatusBadge status={r.status} label={RETURN_STATUS_LABEL[r.status]} /></p>
              ))}
            </section>
          )}

          {canCancel && (
            <form action={cancelOrderAction} className="card space-y-2 border-bad/30 p-4">
              <h2 className="font-semibold">Siparişi iptal et</h2>
              <input type="hidden" name="orderId" value={order.id} />
              <input name="reason" placeholder="İptal nedeni" className="input" aria-label="İptal nedeni" />
              <button className="btn-danger w-full">İptal et ve ücreti iade et</button>
            </form>
          )}

          <section className="card p-4 text-xs">
            <h2 className="mb-2 text-sm font-semibold">İşlem geçmişi</h2>
            <ul className="space-y-1 text-muted">
              {logs.map((l) => <li key={l.id}>{l.createdAt.toLocaleString("tr-TR")} · {l.actorType} · {l.action}</li>)}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
