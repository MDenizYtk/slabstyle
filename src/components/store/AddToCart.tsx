"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PublicVariant } from "@/server/catalog/dto";
import { addToCartAction, type CartActionState } from "@/server/cart/actions";

export function AddToCart({ variants }: { variants: PublicVariant[] }) {
  const [selectedId, setSelectedId] = useState(variants.find((v) => v.purchasable)?.id ?? variants[0]?.id);
  const [quantity, setQuantity] = useState(1);
  const [state, formAction, pending] = useActionState<CartActionState, FormData>(addToCartAction, {});
  const variant = variants.find((v) => v.id === selectedId);

  if (!variant) return <p className="text-muted">Bu ürün şu anda satışta değil.</p>;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="variantId" value={variant.id} />

      <div className="flex items-end gap-3">
        <span className="text-3xl font-bold">{variant.price != null ? formatMoney(variant.price) : "—"}</span>
        {variant.compareAtPrice && <span className="pb-1 text-subtle line-through">{formatMoney(variant.compareAtPrice)}</span>}
      </div>
      <p className="text-xs text-subtle">KDV dahil</p>

      {variants.length > 1 && (
        <fieldset>
          <legend className="label">Seçenek</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setSelectedId(v.id);
                  setQuantity(1);
                }}
                aria-pressed={v.id === selectedId}
                className={cn(
                  "btn border",
                  v.id === selectedId ? "border-accent bg-accent/10 text-fg" : "border-line text-muted hover:border-subtle",
                  !v.purchasable && "opacity-50",
                )}
              >
                {v.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <p className={cn("text-sm font-semibold", variant.stockLevel === "OUT_OF_STOCK" ? "text-bad" : variant.stockLevel === "LOW" ? "text-warn" : "text-ok")}>
        {variant.stockLabel}
      </p>

      <div className="flex gap-3">
        <div className="flex items-center rounded-md border border-line">
          <button type="button" className="px-3 py-2.5 text-muted hover:text-fg" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Azalt">−</button>
          <input
            name="quantity"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.min(variant.maxQty || 1, Number(e.target.value) || 1)))}
            inputMode="numeric"
            className="w-12 bg-transparent text-center text-sm"
            aria-label="Adet"
          />
          <button type="button" className="px-3 py-2.5 text-muted hover:text-fg" onClick={() => setQuantity((q) => Math.min(variant.maxQty || 1, q + 1))} aria-label="Artır">+</button>
        </div>
        <button type="submit" disabled={!variant.purchasable || pending} className="btn-primary flex-1 text-base">
          {pending ? "Ekleniyor…" : variant.purchasable ? "Sepete Ekle" : "Tükendi"}
        </button>
      </div>

      {state.message && (
        <p role="status" className={cn("text-sm", state.ok ? "text-ok" : "text-bad")}>
          {state.message}
          {state.ok && (
            <>
              {" "}
              <Link href="/cart" className="underline">Sepete git</Link>
            </>
          )}
        </p>
      )}
    </form>
  );
}
