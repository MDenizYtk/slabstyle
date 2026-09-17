"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { groupKeyFromFilename, groupNameFromFilename, productNameFromFilename } from "@/domain/catalog/filename";
import { bulkCreateProductsAction, type BulkResult } from "@/server/catalog/bulk-actions";

type Option = { id: string; name: string; parent?: string | null };

/** Bir istekte gönderilecek üst sınırlar (sunucu tarafı da ayrıca kontrol eder). */
const BATCH_FILES = 12;
const BATCH_BYTES = 18 * 1024 * 1024;

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function BulkPhotoUpload({ categories, brands }: { categories: Option[]; brands: Option[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [groupByName, setGroupByName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(0);
  const [result, setResult] = useState<BulkResult | null>(null);

  const preview = useMemo(() => {
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, "tr"));
    const groups = new Map<string, { name: string; count: number }>();
    sorted.forEach((f, i) => {
      const key = groupByName ? groupKeyFromFilename(f.name) : `tek-${i}`;
      const name = groupByName ? groupNameFromFilename(f.name) : productNameFromFilename(f.name);
      const g = groups.get(key) ?? { name, count: 0 };
      g.count++;
      groups.set(key, g);
    });
    return { sorted, groups: [...groups.values()], totalBytes: files.reduce((s, f) => s + f.size, 0) };
  }, [files, groupByName]);

  /** Dosyaları istek sınırlarına göre gruplara böler; aynı ürünün fotoğrafları bölünmez. */
  function buildBatches(): File[][] {
    const batches: File[][] = [];
    let current: File[] = [];
    let currentBytes = 0;
    const chunks = groupByName
      ? [...preview.sorted.reduce((map, f) => {
          const key = groupKeyFromFilename(f.name);
          map.set(key, [...(map.get(key) ?? []), f]);
          return map;
        }, new Map<string, File[]>()).values()]
      : preview.sorted.map((f) => [f]);

    for (const chunk of chunks) {
      const chunkBytes = chunk.reduce((s, f) => s + f.size, 0);
      if (current.length && (current.length + chunk.length > BATCH_FILES || currentBytes + chunkBytes > BATCH_BYTES)) {
        batches.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(...chunk);
      currentBytes += chunkBytes;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  async function upload() {
    const form = formRef.current;
    if (!form || files.length === 0) return;
    const data = new FormData(form);
    const categoryId = String(data.get("categoryId") ?? "");
    if (!categoryId) {
      setResult({ created: 0, updated: 0, photos: 0, errors: ["Önce kategori seçin"] });
      return;
    }

    setBusy(true);
    setUploaded(0);
    const total: BulkResult = { created: 0, updated: 0, photos: 0, errors: [] };
    for (const batch of buildBatches()) {
      const fd = new FormData();
      fd.set("categoryId", categoryId);
      fd.set("status", String(data.get("status") ?? "DRAFT"));
      fd.set("brandId", String(data.get("brandId") ?? ""));
      fd.set("newBrand", String(data.get("newBrand") ?? ""));
      if (groupByName) fd.set("groupByName", "on");
      for (const f of batch) fd.append("images", f);
      try {
        const r = await bulkCreateProductsAction(fd);
        total.created += r.created;
        total.updated += r.updated;
        total.photos += r.photos;
        total.errors.push(...r.errors);
      } catch {
        total.errors.push(`${batch.length} fotoğraflık grup gönderilemedi (bağlantı hatası)`);
      }
      setUploaded((n) => n + batch.length);
      setResult({ ...total });
    }
    setBusy(false);
    setFiles([]);
    if (form.querySelector<HTMLInputElement>('input[type="file"]')) form.querySelector<HTMLInputElement>('input[type="file"]')!.value = "";
  }

  const percent = files.length ? Math.round((uploaded / files.length) * 100) : 0;

  return (
    <form ref={formRef} className="space-y-6" onSubmit={(e) => e.preventDefault()}>
      <section className="card grid gap-4 p-5 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="categoryId">Kategori (zorunlu)</label>
          <select id="categoryId" name="categoryId" className="input" required defaultValue="">
            <option value="" disabled>Kategori seçin</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.parent ? `${c.parent} › ` : ""}{c.name}</option>)}
          </select>
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
            <input id="newBrand" name="newBrand" className="input" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 md:col-span-2">
          <label className="flex items-center gap-2 text-sm text-muted"><input type="radio" name="status" value="DRAFT" defaultChecked className="accent-accent" /> Taslak olarak ekle</label>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="radio" name="status" value="ACTIVE" className="accent-accent" /> Hemen yayınla</label>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={groupByName} onChange={(e) => setGroupByName(e.target.checked)} className="accent-accent" />
            Aynı isimli fotoğrafları tek üründe birleştir
          </label>
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Fotoğraflar</h2>
        <p className="text-xs text-subtle">
          Ürün adı dosya adından alınır: &quot;bmw-f30-sag-far.jpg&quot; → &quot;Bmw F30 Sag Far&quot;. Yükleme otomatik gruplara bölünür,
          fotoğraflar site için küçültülür. Yüzlerce dosyayı birden seçebilirsin.
        </p>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          className="input"
          disabled={busy}
          onChange={(e) => {
            setFiles(Array.from(e.target.files ?? []));
            setResult(null);
            setUploaded(0);
          }}
        />

        {files.length > 0 && !busy && (
          <div className="space-y-2 text-sm">
            <p className="text-muted">
              {files.length} fotoğraf · {mb(preview.totalBytes)} · <strong className="text-fg">{preview.groups.length} ürün</strong> oluşacak
            </p>
            <ul className="max-h-48 overflow-auto rounded-lg border border-line text-xs">
              {preview.groups.slice(0, 50).map((g) => (
                <li key={g.name} className="flex justify-between border-b border-line/60 px-3 py-1.5 last:border-0">
                  <span>{g.name}</span>
                  <span className="text-subtle">{g.count} fotoğraf</span>
                </li>
              ))}
              {preview.groups.length > 50 && <li className="px-3 py-1.5 text-subtle">… ve {preview.groups.length - 50} ürün daha</li>}
            </ul>
          </div>
        )}

        {busy && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2">
              <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-sm text-muted">Yükleniyor… {uploaded}/{files.length} fotoğraf (%{percent})</p>
          </div>
        )}

        <button type="button" onClick={upload} disabled={busy || files.length === 0} className="btn-primary">
          {busy ? "Yükleniyor…" : `Yükle ve ürünleri oluştur`}
        </button>
      </section>

      {result && (
        <section className="card space-y-2 p-5 text-sm">
          <h2 className="font-semibold">Sonuç</h2>
          <p className="text-ok">{result.created} ürün oluşturuldu · {result.updated} ürüne fotoğraf eklendi · {result.photos} fotoğraf yüklendi</p>
          {result.errors.length > 0 && (
            <ul className="space-y-1 text-bad">
              {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
              {result.errors.length > 20 && <li>… ve {result.errors.length - 20} hata daha</li>}
            </ul>
          )}
          {!busy && result.created + result.updated > 0 && (
            <Link href="/admin/products" className="btn-secondary">Ürünlere git ve isim/fiyat düzenle</Link>
          )}
        </section>
      )}
    </form>
  );
}
