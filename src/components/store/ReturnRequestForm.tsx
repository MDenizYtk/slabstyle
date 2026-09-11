"use client";

import { useActionState } from "react";
import { requestReturnAction, type ReturnFormState } from "@/server/returns/customer-actions";
import { cn } from "@/lib/utils";

const REASONS = [
  ["DAMAGED", "Ürün hasarlı geldi"],
  ["WRONG_ITEM", "Yanlış ürün gönderildi"],
  ["NOT_AS_DESCRIBED", "Ürün açıklamadaki gibi değil"],
  ["CHANGED_MIND", "Vazgeçtim"],
  ["OTHER", "Diğer"],
] as const;

export function ReturnRequestForm({ orderId, items }: { orderId: string; items: { id: string; label: string; maxQty: number }[] }) {
  const [state, action, pending] = useActionState<ReturnFormState, FormData>(requestReturnAction, {});

  return (
    <details className="card p-5">
      <summary className="cursor-pointer font-semibold">İade talebi oluştur</summary>
      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="orderId" value={orderId} />
        <fieldset className="space-y-2">
          <legend className="label">İade edilecek ürünler</legend>
          {items.map((item) => (
            <label key={item.id} className="flex items-center justify-between gap-3 text-sm">
              <span>{item.label}</span>
              <select name={`qty:${item.id}`} defaultValue="0" className="input w-20">
                {Array.from({ length: item.maxQty + 1 }, (_, n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
        <div>
          <label htmlFor="reason" className="label">Neden</label>
          <select id="reason" name="reason" required defaultValue="" className="input">
            <option value="" disabled>Seçin</option>
            {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="note" className="label">Açıklama (isteğe bağlı)</label>
          <textarea id="note" name="note" rows={3} maxLength={1000} className="input" />
        </div>
        <button disabled={pending} className="btn-primary">{pending ? "Gönderiliyor…" : "Talebi gönder"}</button>
        {state.message && <p role="status" className={cn("text-sm", state.ok ? "text-ok" : "text-bad")}>{state.message}</p>}
      </form>
    </details>
  );
}
