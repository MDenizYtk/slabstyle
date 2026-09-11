import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BankTransferInfo } from "@/components/store/BankTransferInfo";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db";
import { getBankTransferSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Havale / EFT", robots: { index: false } };

export default async function BankTransferPage(props: PageProps<"/checkout/transfer/[paymentId]">) {
  const { paymentId } = await props.params;
  const user = await requireUser(`/checkout/transfer/${paymentId}`);
  const [payment, settings] = await Promise.all([
    db.payment.findFirst({
      where: { id: paymentId, provider: "bank_transfer", order: { userId: user.id } },
      select: { amount: true, status: true, createdAt: true, order: { select: { id: true, number: true, status: true } } },
    }),
    getBankTransferSettings(db),
  ]);
  if (!payment) notFound();
  const paid = payment.status === "CAPTURED" || payment.order.status !== "PENDING_PAYMENT";

  return (
    <div className="container-x flex justify-center py-16">
      <div className="w-full max-w-xl space-y-6 text-center">
        <p className="text-sm font-bold uppercase tracking-[0.3em] text-accent">Siparişin alındı</p>
        <h1 className="slab text-4xl">Sipariş #{payment.order.number}</h1>
        {paid ? (
          <p className="card p-6 text-muted">Ödemen onaylandı, siparişin hazırlanıyor.</p>
        ) : payment.status === "PENDING" ? (
          <>
            <p className="text-muted">Siparişini tamamlamak için aşağıdaki hesaba havale/EFT yap. Ürünlerin senin için ayrıldı.</p>
            <BankTransferInfo settings={settings} amount={payment.amount} orderNumber={payment.order.number} createdAt={payment.createdAt} />
          </>
        ) : (
          <p className="card p-6 text-muted">Bu ödeme artık geçerli değil. Sipariş detayından durumu kontrol edebilirsin.</p>
        )}
        <div className="flex justify-center gap-3">
          <Link href={`/account/orders/${payment.order.id}`} className="btn-secondary">Siparişi görüntüle</Link>
          <Link href="/products" className="btn-ghost">Alışverişe devam et</Link>
        </div>
      </div>
    </div>
  );
}
