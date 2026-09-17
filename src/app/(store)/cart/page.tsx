import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isShop } from "@/config/mode";
import { ProductImage } from "@/components/store/ProductImage";
import { LINE_ISSUE_TEXT } from "@/domain/cart/totals";
import { formatMoney } from "@/lib/money";
import { removeCartItemAction, updateCartItemAction } from "@/server/cart/actions";
import { getCartView } from "@/server/cart/service";

export const metadata: Metadata = { title: "Sepet", robots: { index: false } };

export default async function CartPage() {
  if (!isShop) notFound(); // vitrin modunda sepet kapalı
  const { lines, totals } = await getCartView();

  if (lines.length === 0) {
    return (
      <div className="container-x py-20 text-center">
        <h1 className="slab text-4xl">Sepetin boş</h1>
        <p className="mt-3 text-muted">Aracına iyi bakmak için ilk ürünü ekle.</p>
        <Link href="/products" className="btn-primary mt-8">Alışverişe başla</Link>
      </div>
    );
  }

  return (
    <div className="container-x py-10">
      <h1 className="slab mb-8 text-4xl">Sepet</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <ul className="space-y-3">
          {lines.map((line) => (
            <li key={line.itemId} className="card flex gap-4 p-4">
              <Link href={`/products/${line.productSlug}`} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-panel-2">
                <ProductImage src={line.imageUrl} alt={line.productName} sizes="96px" />
              </Link>
              <div className="flex flex-1 flex-col gap-1">
                <Link href={`/products/${line.productSlug}`} className="font-semibold hover:text-accent">{line.productName}</Link>
                <span className="text-sm text-muted">{line.variantName}</span>
                {line.issue && <span className="text-sm text-bad">{LINE_ISSUE_TEXT[line.issue]}</span>}
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
                  <div className="flex items-center rounded-md border border-line">
                    <form action={updateCartItemAction}>
                      <input type="hidden" name="itemId" value={line.itemId} />
                      <input type="hidden" name="quantity" value={line.quantity - 1} />
                      <button className="px-3 py-1.5 text-muted hover:text-fg" aria-label="Azalt">−</button>
                    </form>
                    <span className="w-8 text-center text-sm" aria-label="Adet">{line.quantity}</span>
                    <form action={updateCartItemAction}>
                      <input type="hidden" name="itemId" value={line.itemId} />
                      <input type="hidden" name="quantity" value={Math.min(line.quantity + 1, Math.max(line.maxQty, 1))} />
                      <button className="px-3 py-1.5 text-muted hover:text-fg disabled:opacity-40" disabled={line.quantity >= line.maxQty} aria-label="Artır">+</button>
                    </form>
                  </div>
                  <form action={removeCartItemAction}>
                    <input type="hidden" name="itemId" value={line.itemId} />
                    <button className="text-sm text-subtle hover:text-bad">Kaldır</button>
                  </form>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold">{line.issue ? "—" : formatMoney(line.lineTotal)}</p>
                {line.unitPrice != null && line.quantity > 1 && <p className="text-xs text-subtle">{formatMoney(line.unitPrice)} / adet</p>}
              </div>
            </li>
          ))}
        </ul>

        <aside className="card h-fit space-y-3 p-6 lg:sticky lg:top-40">
          <h2 className="slab text-xl">Sipariş özeti</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Ara toplam ({totals.itemCount} ürün)</dt><dd>{formatMoney(totals.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Kargo</dt><dd>{totals.shippingTotal === 0 ? "Ücretsiz" : formatMoney(totals.shippingTotal)}</dd></div>
            <div className="flex justify-between border-t border-line pt-3 text-base font-bold"><dt>Toplam</dt><dd>{formatMoney(totals.grandTotal)}</dd></div>
            <p className="text-xs text-subtle">KDV dahil ({formatMoney(totals.taxTotal)})</p>
          </dl>
          {totals.hasIssues && <p className="text-sm text-warn">Bazı ürünlerde sorun var; bunlar siparişe dahil edilmeyecek.</p>}
          <Link href="/checkout" aria-disabled={totals.itemCount === 0} className={`btn-primary w-full ${totals.itemCount === 0 ? "pointer-events-none opacity-50" : ""}`}>
            Ödemeye geç
          </Link>
          <p className="text-center text-xs text-subtle">Fiyat ve stok ödeme adımında yeniden doğrulanır.</p>
        </aside>
      </div>
    </div>
  );
}
