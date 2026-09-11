import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ORDER_STATUS_LABEL } from "@/domain/orders/status";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db";
import { retryPaymentAction } from "@/server/orders/checkout-actions";

export const metadata: Metadata = { title: "Sipariş", robots: { index: false } };

export default async function CheckoutResultPage(props: PageProps<"/checkout/success/[orderId]">) {
  const { orderId } = await props.params;
  const failed = (await props.searchParams).failed === "1";
  const user = await requireUser(`/checkout/success/${orderId}`);
  const order = await db.order.findFirst({
    where: { id: orderId, userId: user.id },
    select: { id: true, number: true, status: true, grandTotal: true, email: true },
  });
  if (!order) notFound();
  const pending = order.status === "PENDING_PAYMENT";

  return (
    <div className="container-x flex justify-center py-16">
      <div className="card w-full max-w-lg space-y-5 p-8 text-center">
        {pending ? (
          <>
            <h1 className="slab text-3xl">{failed ? "Ödeme tamamlanamadı" : "Ödeme bekleniyor"}</h1>
            <p className="text-muted">
              {failed ? "Ödemen alınamadı. Kartını kontrol edip tekrar deneyebilirsin." : "Ödemen onaylandığında siparişin hazırlanmaya başlayacak."}
              {" "}Sipariş ödeme yapılmazsa 30 dakika sonra otomatik iptal edilir.
            </p>
            <form action={retryPaymentAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <button className="btn-primary">Ödemeyi tekrar dene · {formatMoney(order.grandTotal)}</button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-accent">Teşekkürler</p>
            <h1 className="slab text-4xl">Siparişin alındı</h1>
            <p className="text-muted">Sipariş numaran <strong className="text-fg">#{order.number}</strong>. Onay bilgisi {order.email} adresine gönderilecek.</p>
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
