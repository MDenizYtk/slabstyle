"use client";

import { deleteCategoryAction } from "@/server/catalog/category-actions";

/**
 * Kategori satırındaki sil butonu. Satırın kendi formunu (gizli id alanıyla)
 * farklı bir action'a gönderir; silmeden önce etkileri anlatan onay ister.
 */
export function DeleteCategoryButton({ name, productCount, childCount }: { name: string; productCount: number; childCount: number }) {
  return (
    <button
      formAction={deleteCategoryAction}
      formNoValidate
      className="btn-danger text-xs"
      onClick={(e) => {
        const lines = [`"${name}" kategorisi silinsin mi?`];
        if (productCount) lines.push(`${productCount} ürün silinmez, kategorisiz kalır.`);
        if (childCount) lines.push(`${childCount} alt kategori ana kategoriye dönüşür.`);
        lines.push("Bu kategoriye özel fiyat kuralı varsa o da silinir.");
        if (!window.confirm(lines.join("\n"))) e.preventDefault();
      }}
    >
      Sil
    </button>
  );
}
