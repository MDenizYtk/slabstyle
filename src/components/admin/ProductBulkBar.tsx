"use client";

import { useState } from "react";
import { bulkProductsAction } from "@/server/catalog/bulk-actions";

/**
 * Ürün listesinin üstündeki toplu işlem çubuğu. Butonlar listeyi saran formu
 * farklı işlemlerle gönderir; silmeden önce onay ister.
 */
export function ProductBulkBar({ canDelete }: { canDelete: boolean }) {
  const [selected, setSelected] = useState(0);

  // Seçim sayısını formdaki kutulardan okur (her tıklamada güncellenir).
  const refresh = (el: HTMLElement) => {
    const form = el.closest("form");
    setSelected(form ? form.querySelectorAll<HTMLInputElement>('input[name="selected"]:checked').length : 0);
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel p-3" onClick={(e) => refresh(e.currentTarget)}>
      <span className="text-sm text-muted">{selected > 0 ? `${selected} ürün seçili` : "Satırlarda isim ve fiyatı düzenleyip kaydedebilir, seçtiklerine toplu işlem uygulayabilirsin."}</span>
      <div className="ml-auto flex flex-wrap gap-2">
        <button formAction={bulkProductsAction} name="op" value="save" className="btn-primary text-xs">Değişiklikleri kaydet</button>
        <button formAction={bulkProductsAction} name="op" value="publish" className="btn-secondary text-xs">Seçilenleri yayınla</button>
        <button formAction={bulkProductsAction} name="op" value="draft" className="btn-secondary text-xs">Taslağa al</button>
        <button formAction={bulkProductsAction} name="op" value="archive" className="btn-ghost text-xs">Arşivle</button>
        {canDelete && (
          <button
            formAction={bulkProductsAction}
            name="op"
            value="delete"
            className="btn-danger text-xs"
            onClick={(e) => {
              const form = e.currentTarget.form;
              const count = form?.querySelectorAll<HTMLInputElement>('input[name="selected"]:checked').length ?? 0;
              if (count === 0) return;
              if (!window.confirm(`${count} ürün silinsin mi?\n\nFotoğrafları da silinir, geri alınamaz.`)) e.preventDefault();
            }}
          >
            Seçilenleri sil
          </button>
        )}
      </div>
    </div>
  );
}

/** Başlıktaki "tümünü seç" kutusu. */
export function SelectAllCheckbox() {
  return (
    <input
      type="checkbox"
      aria-label="Tümünü seç"
      className="accent-accent"
      onChange={(e) => {
        const form = e.currentTarget.closest("form");
        form?.querySelectorAll<HTMLInputElement>('input[name="selected"]').forEach((box) => {
          box.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}
