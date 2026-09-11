import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BankTransferInfo } from "@/components/store/BankTransferInfo";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ORDER_STATUS_LABEL } from "@/domain/orders/status";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db";
import { retryPaymentAction } from "@/server/orders/checkout-actions";
import { getAvailablePaymentMethods } from "@/server/payments/service";
import { getBankTransferSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Sipariş", robots: { index: false } };

export default async function CheckoutResultPage(props: PageProps<"/checkout/success/[orderId]">) {
  const { orderId } = await props.params;
  const failed = (await props.searchParams).failed === "1";
  const user = await requireUser(`/checkout/success/${orderId}`);
  const order = await db.order.findFirst({
    where: { id: orderId, userId: user.id },
    select: {
      id: true, number: true, status: true, grandTotal: true, email: true,
      payments: { orderBy: { createdAt: "desc" }, take: 1, select: { provider: true, status: true, amount: true, createdAt: true } },
    },
  });
  if (!order) notFound();
  const pending = order.status === "PENDING_PAYMENT";
  const last = order.payments[0];
  const awaitingTransfer = pending && last?.provider === "bank_transfer" && last.status === "PENDING";
  const [methods, bank] = await Promise.all([getAvailablePaymentMethods(db), awaitingTransfer ? getBankTransferSettings(db) : null]);

  return (
    <div className="container-x flex justify-center py-16">
      <div className="card w-full max-w-lg space-y-5 p-8 text-center">
        {awaitingTransfer && bank && last ? (
          <>
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-accent">Siparişin alındı</p>
            <h1 className="slab text-3xl">Havale bekleniyor</h1>
            <BankTransferInfo settings={bank} amount={last.amount} orderNumber={order.number} createdAt={last.createdAt} />
          </>
        ) : pending ? (
          <>
            <h1 className="slab text-3xl">{failed ? "Ödeme tamamlanamadı" : "Ödeme bekleniyor"}</h1>
            <p className="text-muted">
              {failed ? "Ödemen alınamadı. Tekrar deneyebilir ya da başka bir yöntem seçebilirsin." : "Ödemen onaylandığında siparişin hazırlanmaya başlayacak."}
            </p>
            <div className="flex flex-col gap-2">
              {methods.map((m) => (
                <form key={m.id} action={retryPaymentAction}>
                  <input type="hidden" name="orderId" value={order.id} />
                  <input type="hidden" name="paymentMethod" value={m.id} />
                  <button className={m.id === methods[0].id ? "btn-primary w-full" : "btn-secondary w-full"}>
                    {m.label} ile öde · {formatMoney(order.grandTotal)}
                  </button>
                </form>
              ))}
              {methods.length === 0 && <p className="text-sm text-warn">Şu anda ödeme alınamıyor.</p>}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-accent">Teşekkürler</p>
            <h1 className="slab text-4xl">Siparişin alındı</h1>
            <p className="text-muted">Sipariş numaran <strong className="text-fg">#{order.number}</strong>. Durumunu hesabından takip edebilirsin.</p>
            <StatusBadge status={order.status} label={ORDER_STATUS_LABEL[order.status]} />
          </>
        )}
        <div className="flex justify-center gap-3 pt-2">
          <Link href={`/account/orders/${order.id}`} className="btn-secondary">Siparişi görüntüle</Link>
          <Link href="/products" className="btn-ghost">Alışverişe devam et</Link>
        </div>
      </div>
    </div>
  );
}
