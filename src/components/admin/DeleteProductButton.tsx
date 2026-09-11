"use client";

import { deleteProductAction } from "@/server/catalog/product-admin";

export function DeleteProductButton({ productId, name, className = "btn-danger text-xs" }: { productId: string; name: string; className?: string }) {
  return (
    <form
      action={deleteProductAction}
      onSubmit={(e) => {
        const ok = window.confirm(
          `"${name}" ürünü silinsin mi?\n\nFotoğrafları ve varyantları silinir. Geçmiş siparişler etkilenmez.\nTedarikçi teklifleri eşleştirme ekranına "eşleşmemiş" olarak düşer.\n\nGeri alınamaz. Sadece satıştan kaldırmak istiyorsan durumu "Arşiv" yap.`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="productId" value={productId} />
      <button className={className}>Sil</button>
    </form>
  );
}
