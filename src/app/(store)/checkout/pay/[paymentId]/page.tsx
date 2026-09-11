import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/auth/dal";
import { db } from "@/server/db";
import { mockPayAction } from "@/server/orders/checkout-actions";

export const metadata: Metadata = { title: "Ödeme", robots: { index: false } };

/**
 * MOCK ödeme sayfası. Gerçek sağlayıcı (iyzico, PayTR vb.) bağlandığında
 * müşteri bu sayfa yerine sağlayıcının güvenli ödeme sayfasına yönlenir.
 */
export default async function MockPayPage(props: PageProps<"/checkout/pay/[paymentId]">) {
  const { paymentId } = await props.params;
  const user = await requireUser(`/checkout/pay/${paymentId}`);
  const payment = await db.payment.findFirst({
    where: { id: paymentId, provider: "mock", status: "PENDING", order: { userId: user.id } },
    select: { id: true, amount: true, order: { select: { number: true } } },
  });
  if (!payment) notFound();

  return (
    <div className="container-x flex justify-center py-16">
      <div className="card w-full max-w-md space-y-6 p-8 text-center">
        <p className="badge mx-auto bg-warn/15 text-warn">MOCK ÖDEME — GERÇEK PARA ÇEKİLMEZ</p>
        <h1 className="slab text-3xl">Sipariş #{payment.order.number}</h1>
        <p className="text-4xl font-bold">{formatMoney(payment.amount)}</p>
        <p className="text-sm text-muted">
          Bu sayfa geliştirme ortamı içindir. Gerçek ödeme sağlayıcısı bağlandığında kart bilgileri sağlayıcının güvenli sayfasında girilir.
        </p>
        <div className="flex flex-col gap-3">
          <form action={mockPayAction}>
            <input type="hidden" name="paymentId" value={payment.id} />
            <input type="hidden" name="outcome" value="success" />
            <button className="btn-primary w-full">Ödemeyi onayla (MOCK)</button>
          </form>
          <form action={mockPayAction}>
            <input type="hidden" name="paymentId" value={payment.id} />
            <input type="hidden" name="outcome" value="fail" />
            <button className="btn-secondary w-full">Ödeme başarısız (MOCK)</button>
          </form>
        </div>
      </div>
    </div>
  );
}
