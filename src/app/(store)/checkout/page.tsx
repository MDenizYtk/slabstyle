import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutForm } from "@/components/store/CheckoutForm";
import { isShop } from "@/config/mode";
import { requireUser } from "@/server/auth/dal";
import { getCartView, loadCartView } from "@/server/cart/service";
import { db } from "@/server/db";
import { randomToken } from "@/server/security/crypto";
import { getShippingSettings } from "@/server/settings";
import { getAvailablePaymentMethods } from "@/server/payments/service";

export const metadata: Metadata = { title: "Ödeme", robots: { index: false } };

export default async function CheckoutPage() {
  if (!isShop) notFound(); // vitrin modunda ödeme kapalı
  const user = await requireUser("/checkout");
  const cart = await getCartView("standard");
  if (cart.lines.length === 0 || !cart.cartId) redirect("/cart");

  const [express, addresses, shipping, paymentMethods] = await Promise.all([
    loadCartView(cart.cartId, "express"),
    db.address.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    getShippingSettings(db),
    getAvailablePaymentMethods(db),
  ]);

  const methods = [
    { id: "standard" as const, label: shipping.methods.standard.label, etaDays: shipping.methods.standard.etaDays, enabled: shipping.methods.standard.enabled, shipping: cart.totals.shippingTotal, grandTotal: cart.totals.grandTotal },
    { id: "express" as const, label: shipping.methods.express.label, etaDays: shipping.methods.express.etaDays, enabled: shipping.methods.express.enabled, shipping: express.totals.shippingTotal, grandTotal: express.totals.grandTotal },
  ].filter((m) => m.enabled);

  return (
    <div className="container-x py-10">
      <h1 className="slab mb-2 text-4xl">Ödeme</h1>
      <p className="mb-8 text-sm text-muted">Adres → Kargo → Özet → Ödeme</p>
      {cart.totals.hasIssues && (
        <p className="card mb-6 border-warn/40 p-4 text-sm text-warn">
          Sepetinizdeki bazı ürünlerin stoğu veya fiyatı değişti. <Link href="/cart" className="underline">Sepete dönüp kontrol edin</Link>.
        </p>
      )}
      <CheckoutForm
        addresses={addresses.map((a) => ({ id: a.id, title: a.title, fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2, district: a.district, city: a.city }))}
        methods={methods}
        subtotal={cart.totals.subtotal}
        itemCount={cart.totals.itemCount}
        idempotencyKey={randomToken(24)}
        paymentMethods={paymentMethods}
      />
    </div>
  );
}
