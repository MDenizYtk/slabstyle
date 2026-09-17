"use client";

import { useActionState, useEffect, useState } from "react";
import { createProductAction, type ProductFormState } from "@/server/catalog/product-admin";

type Option = { id: string; name: string };

type Row = { key: number };

export function ProductCreateForm({
  categories,
  brands,
  showStock,
}: {
  categories: (Option & { parent: string | null })[];
  brands: Option[];
  /** Vitrin modunda stok ve maliyet alanları gizlenir. */
  showStock: boolean;
}) {
  const [state, action, pending] = useActionState<ProductFormState, FormData>(createProductAction, {});
  const [rows, setRows] = useState<Row[]>([{ key: 1 }]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fe = state.fieldErrors ?? {};

  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  return (
    <form action={action} className="space-y-6">
      {state.error && <p role="alert" className="rounded-md border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{state.error}</p>}

      <section className="card grid gap-4 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Ürün bilgileri</h2>
        <div className="md:col-span-2">
          <label className="label" htmlFor="name">Ürün adı</label>
          <input id="name" name="name" className="input" required maxLength={300} />
          {fe.name && <p className="field-error">{fe.name}</p>}
        </div>
        <div>
          <label className="label" htmlFor="categoryId">Kategori</label>
          <select id="categoryId" name="categoryId" className="input" required defaultValue="">
            <option value="" disabled>Kategori seçin</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.parent ? `${c.parent} › ` : ""}{c.name}</option>)}
          </select>
          {fe.categoryId && <p className="field-error">{fe.categoryId}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="brandId">Marka</label>
            <select id="brandId" name="brandId" className="input" defaultValue="">
              <option value="">—</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="newBrand">veya yeni marka</label>
            <input id="newBrand" name="newBrand" className="input" placeholder="Marka adı" />
          </div>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="shortDesc">Kısa açıklama</label>
          <input id="shortDesc" name="shortDesc" className="input" maxLength={500} />
        </div>
        <div>
          <label className="label" htmlFor="description">Açıklama</label>
          <textarea id="description" name="description" rows={6} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="specs">Teknik özellikler (her satır &quot;Etiket: Değer&quot;)</label>
          <textarea id="specs" name="specs" rows={6} className="input font-mono text-xs" placeholder={"Hacim: 500 ml\npH: 7"} />
        </div>
        <div className="flex flex-wrap items-center gap-4 md:col-span-2">
          <label className="flex items-center gap-2 text-sm text-muted"><input type="radio" name="status" value="DRAFT" defaultChecked className="accent-accent" /> Taslak</label>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="radio" name="status" value="ACTIVE" className="accent-accent" /> Hemen yayınla</label>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" name="isFeatured" className="accent-accent" /> Popüler ürünlerde göster</label>
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Fotoğraflar</h2>
        <p className="text-xs text-subtle">JPG, PNG, WEBP veya AVIF · her biri en fazla 5 MB · en fazla 10 adet. İlk fotoğraf ana görsel olur.</p>
        <input
          name="images"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          className="input"
          onChange={(e) => setPreviews(Array.from(e.target.files ?? []).map((f) => URL.createObjectURL(f)))}
        />
        {fe.images && <p className="field-error">{fe.images}</p>}
        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {previews.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- yerel önizleme (blob URL)
              <img key={src} src={src} alt={`Önizleme ${i + 1}`} className={`aspect-square w-full rounded-lg object-cover ${i === 0 ? "ring-2 ring-accent" : ""}`} />
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Varyantlar ve ürün kodları</h2>
          <button type="button" className="btn-secondary text-xs" onClick={() => setRows((r) => [...r, { key: Date.now() }])}>Varyant ekle</button>
        </div>
        <p className="text-xs text-subtle">
          Ürün kodu boş bırakılırsa otomatik üretilir.
          {showStock
            ? " Stok girerseniz ürün \"Kendi Stoğum\" olarak satışa açılır. Satış fiyatı boşsa fiyat kurallarına göre maliyetten hesaplanır."
            : " Fiyat boş bırakılırsa ürün sayfasında fiyat gösterilmez (\"fiyat için arayın\")."}
        </p>
        <div className="overflow-x-auto">
          <table className="table-x min-w-[900px]">
            <thead>
              <tr>
                <th>Seçenek adı</th><th>Ürün kodu (SKU)</th><th>Barkod</th><th>Üretici kodu</th><th>Satış (TL)</th><th>Üstü çizili (TL)</th>
                {showStock && <><th>Maliyet (TL)</th><th>Stok</th></>}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.key}>
                  <td><input name="variantName" placeholder={i === 0 ? "Standart / 500 ml" : "1 L"} className="input" aria-label="Seçenek adı" /></td>
                  <td><input name="variantSku" placeholder="SS-1001" className="input font-mono" aria-label="Ürün kodu" /></td>
                  <td><input name="variantGtin" placeholder="8690000000000" inputMode="numeric" className="input font-mono" aria-label="Barkod" /></td>
                  <td><input name="variantMpn" className="input font-mono" aria-label="Üretici kodu" /></td>
                  <td><input name="variantPrice" inputMode="decimal" placeholder="499,90" className="input" aria-label="Satış fiyatı" /></td>
                  <td><input name="variantCompareAt" inputMode="decimal" className="input" aria-label="Üstü çizili fiyat" /></td>
                  {showStock && (
                    <>
                      <td><input name="variantCost" inputMode="decimal" className="input" aria-label="Maliyet" /></td>
                      <td><input name="variantStock" type="number" min={0} className="input w-20" aria-label="Stok" /></td>
                    </>
                  )}
                  <td>
                    {rows.length > 1 && (
                      <button type="button" className="btn-ghost text-xs" onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))} aria-label="Satırı sil">Sil</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <button disabled={pending} className="btn-primary">{pending ? "Kaydediliyor…" : "Ürünü kaydet"}</button>
    </form>
  );
}
