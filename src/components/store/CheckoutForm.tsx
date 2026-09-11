"use client";

import { useActionState, useState } from "react";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { placeOrderAction, type CheckoutState } from "@/server/orders/checkout-actions";

type SavedAddress = { id: string; title: string; fullName: string; phone: string; line1: string; line2: string | null; district: string; city: string };
type Method = { id: "standard" | "express"; label: string; etaDays: string; shipping: number; grandTotal: number };

function Err({ list }: { list?: string[] }) {
  return list?.length ? <p className="field-error">{list[0]}</p> : null;
}

/**
 * Checkout: 1) adres 2) kargo 3) özet 4) ödeme. Buradaki tutarlar yalnızca
 * gösterim içindir; sipariş tutarı sunucuda yeniden hesaplanır.
 */
export function CheckoutForm({
  addresses,
  methods,
  subtotal,
  itemCount,
  idempotencyKey,
}: {
  addresses: SavedAddress[];
  methods: Method[];
  subtotal: number;
  itemCount: number;
  idempotencyKey: string;
}) {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(placeOrderAction, {});
  const [addressId, setAddressId] = useState(addresses[0]?.id ?? "new");
  const [methodId, setMethodId] = useState<Method["id"]>(methods[0]?.id ?? "standard");
  const method = methods.find((m) => m.id === methodId) ?? methods[0];
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="space-y-6">
        <section className="card p-6" aria-labelledby="step-address">
          <h2 id="step-address" className="slab mb-4 text-xl"><span className="text-accent">1.</span> Teslimat adresi</h2>
          <div className="space-y-2">
            {addresses.map((a) => (
              <label key={a.id} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 text-sm", addressId === a.id ? "border-accent bg-accent/5" : "border-line")}>
                <input type="radio" name="addressId" value={a.id} checked={addressId === a.id} onChange={() => setAddressId(a.id)} className="mt-1 accent-accent" />
                <span>
                  <span className="font-semibold">{a.title}</span> · {a.fullName} · {a.phone}
                  <br />
                  <span className="text-muted">{a.line1} {a.line2} {a.district}/{a.city}</span>
                </span>
              </label>
            ))}
            <label className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 text-sm", addressId === "new" ? "border-accent bg-accent/5" : "border-line")}>
              <input type="radio" name="addressId" value="new" checked={addressId === "new"} onChange={() => setAddressId("new")} className="accent-accent" />
              Yeni adres ekle
            </label>
          </div>

          {addressId === "new" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="fullName">Ad soyad</label><input id="fullName" name="fullName" autoComplete="name" className="input" required /><Err list={fe.fullName} /></div>
              <div><label className="label" htmlFor="phone">Cep telefonu</label><input id="phone" name="phone" autoComplete="tel" inputMode="tel" placeholder="05xx xxx xx xx" className="input" required /><Err list={fe.phone} /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="line1">Adres</label><input id="line1" name="line1" autoComplete="address-line1" className="input" required /><Err list={fe.line1} /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="line2">Adres (devam)</label><input id="line2" name="line2" autoComplete="address-line2" className="input" /></div>
              <div><label className="label" htmlFor="district">İlçe</label><input id="district" name="district" className="input" required /><Err list={fe.district} /></div>
              <div><label className="label" htmlFor="city">İl</label><input id="city" name="city" autoComplete="address-level1" className="input" required /><Err list={fe.city} /></div>
              <div><label className="label" htmlFor="postalCode">Posta kodu</label><input id="postalCode" name="postalCode" autoComplete="postal-code" className="input" /></div>
              <div><label className="label" htmlFor="title">Adres başlığı</label><input id="title" name="title" placeholder="Ev, İş…" className="input" /></div>
              <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
                <input type="checkbox" name="saveAddress" defaultChecked className="accent-accent" /> Bu adresi hesabıma kaydet
              </label>
            </div>
          )}
        </section>

        <section className="card p-6" aria-labelledby="step-shipping">
          <h2 id="step-shipping" className="slab mb-4 text-xl"><span className="text-accent">2.</span> Kargo</h2>
          <div className="space-y-2">
            {methods.map((m) => (
              <label key={m.id} className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-sm", methodId === m.id ? "border-accent bg-accent/5" : "border-line")}>
                <span className="flex items-center gap-3">
                  <input type="radio" name="shippingMethod" value={m.id} checked={methodId === m.id} onChange={() => setMethodId(m.id)} className="accent-accent" />
                  <span><span className="font-semibold">{m.label}</span><br /><span className="text-muted">{m.etaDays}</span></span>
                </span>
                <span className="font-semibold">{m.shipping === 0 ? "Ücretsiz" : formatMoney(m.shipping)}</span>
              </label>
            ))}
          </div>
          <label className="label mt-4" htmlFor="note">Sipariş notu (isteğe bağlı)</label>
          <textarea id="note" name="note" rows={2} maxLength={500} className="input" />
        </section>
      </div>

      <aside className="card h-fit space-y-4 p-6 lg:sticky lg:top-40">
        <h2 className="slab text-xl"><span className="text-accent">3.</span> Sipariş özeti</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Ara toplam ({itemCount} ürün)</dt><dd>{formatMoney(subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Kargo</dt><dd>{method.shipping === 0 ? "Ücretsiz" : formatMoney(method.shipping)}</dd></div>
          <div className="flex justify-between border-t border-line pt-3 text-base font-bold"><dt>Toplam</dt><dd>{formatMoney(method.grandTotal)}</dd></div>
          <p className="text-xs text-subtle">KDV dahil</p>
        </dl>
        <label className="flex gap-2 text-xs text-muted">
          <input type="checkbox" name="terms" required className="mt-0.5 accent-accent" />
          <span>Ön bilgilendirme formunu ve mesafeli satış sözleşmesini okudum, onaylıyorum.</span>
        </label>
        <Err list={fe.terms} />
        {state.error && <p role="alert" className="rounded-md border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{state.error}</p>}
        <button disabled={pending} className="btn-primary w-full text-base">
          <span className="text-accent-hover" aria-hidden="true" />
          {pending ? "Sipariş oluşturuluyor…" : "4. Ödemeye geç"}
        </button>
        <p className="text-center text-xs text-subtle">Fiyat ve stok bu adımda sunucuda yeniden doğrulanır.</p>
      </aside>
    </form>
  );
}
