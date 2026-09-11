import Link from "next/link";
import type { ReturnStatus } from "@/generated/prisma/client";
import { EmptyRow, Flash, PageHeader } from "@/components/admin/ui";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RETURN_STATUS_LABEL } from "@/domain/orders/status";
import { refundAmountForItems } from "@/domain/payments/refund";
import { formatMoney } from "@/lib/money";
import { readFlash } from "@/server/admin/flash";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";
import { approveReturnAction, receivedReturnAction, refundReturnAction, rejectReturnAction } from "@/server/returns/admin-actions";

export const metadata = { title: "İadeler" };

export default async function AdminReturnsPage(props: PageProps<"/admin/returns">) {
  const user = await requireStaff();
  const sp = await props.searchParams;
  const flash = readFlash(sp);
  const status = typeof sp.status === "string" && sp.status in RETURN_STATUS_LABEL ? (sp.status as ReturnStatus) : undefined;

  const returns = await db.return.findMany({
    where: status ? { status } : { status: { in: ["REQUESTED", "APPROVED", "RECEIVED"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      order: { select: { id: true, number: true } },
      user: { select: { name: true, email: true } },
      supplierOrder: { select: { externalOrderId: true, supplier: { select: { name: true } } } },
      items: { include: { orderItem: { select: { productName: true, variantName: true, unitPrice: true } } } },
    },
  });

  return (
    <>
      <PageHeader title="İadeler" description="Her iade talebi hangi tedarikçiden gönderildiğini bilir; ürünün o tedarikçiye iade edilmesi gerekir." />
      <Flash message={flash.message} tone={flash.tone} />
      <form className="mb-4 flex gap-2">
        <select name="status" defaultValue={status ?? ""} className="input max-w-52">
          <option value="">Açık iadeler</option>
          {Object.entries(RETURN_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn-primary">Filtrele</button>
      </form>

      <div className="space-y-3">
        {returns.length === 0 && <table className="card table-x"><tbody><EmptyRow colSpan={1} text="İade talebi yok" /></tbody></table>}
        {returns.map((r) => {
          const amount = refundAmountForItems(r.items.map((i) => ({ unitPrice: i.orderItem.unitPrice, quantity: i.quantity })));
          return (
            <article key={r.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    <Link href={`/admin/orders/${r.order.id}`} className="text-accent">#{r.order.number}</Link> · {r.user.name}
                    <span className="text-xs text-subtle"> · {r.user.email}</span>
                  </p>
                  <p className="text-sm text-muted">Tedarikçi: <strong className="text-fg">{r.supplierOrder?.supplier.name ?? "atanmamış"}</strong>{r.supplierOrder?.externalOrderId ? ` · dış no ${r.supplierOrder.externalOrderId}` : ""}</p>
                  <p className="text-sm">Neden: {r.reason}{r.customerNote ? ` · "${r.customerNote}"` : ""}</p>
                  <ul className="mt-1 text-sm text-muted">
                    {r.items.map((i) => <li key={i.id}>{i.orderItem.productName} · {i.orderItem.variantName} × {i.quantity}</li>)}
                  </ul>
                </div>
                <div className="text-right">
                  <StatusBadge status={r.status} label={RETURN_STATUS_LABEL[r.status]} />
                  <p className="mt-2 text-sm">İade tutarı: <strong>{formatMoney(amount)}</strong></p>
                  <p className="text-xs text-subtle">{r.createdAt.toLocaleString("tr-TR")}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                {r.status === "REQUESTED" && (
                  <>
                    <form action={approveReturnAction} className="flex gap-2">
                      <input type="hidden" name="returnId" value={r.id} />
                      <input name="note" placeholder="Not (isteğe bağlı)" className="input w-56 text-xs" aria-label="Not" />
                      <button className="btn-primary text-xs">Onayla</button>
                    </form>
                    <form action={rejectReturnAction} className="flex gap-2">
                      <input type="hidden" name="returnId" value={r.id} />
                      <input name="note" placeholder="Red nedeni" className="input w-56 text-xs" aria-label="Red nedeni" />
                      <button className="btn-danger text-xs">Reddet</button>
                    </form>
                  </>
                )}
                {r.status === "APPROVED" && (
                  <form action={receivedReturnAction}>
                    <input type="hidden" name="returnId" value={r.id} />
                    <button className="btn-secondary text-xs">Ürün teslim alındı</button>
                  </form>
                )}
                {(r.status === "APPROVED" || r.status === "RECEIVED") && user.role === "ADMIN" && (
                  <form action={refundReturnAction}>
                    <input type="hidden" name="returnId" value={r.id} />
                    <button className="btn-primary text-xs">{formatMoney(amount)} iade et</button>
                  </form>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
