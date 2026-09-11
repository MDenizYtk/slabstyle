import { buildQuery, SORT_OPTIONS, type ListParams } from "@/domain/catalog/params";
import type { ProductListResult } from "@/server/catalog/queries";
import { Pagination } from "./Pagination";
import { ProductGrid } from "./ProductCard";

/**
 * Listeleme, kategori ve arama sayfalarının ortak görünümü: filtre formu +
 * ürün ızgarası + sayfalama. Filtreler GET formu olduğundan JavaScript
 * olmadan da çalışır ve URL paylaşılabilir.
 */
export function ProductListing({ basePath, params, result }: { basePath: string; params: ListParams; result: ProductListResult }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
      <aside>
        <form method="get" action={basePath} className="card space-y-6 p-5 lg:sticky lg:top-40">
          {params.q && <input type="hidden" name="q" value={params.q} />}

          <div>
            <label htmlFor="sort" className="label">Sıralama</label>
            <select id="sort" name="sort" defaultValue={params.sort} className="input">
              {Object.entries(SORT_OPTIONS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {result.brandFacets.length > 0 && (
            <fieldset>
              <legend className="label">Marka</legend>
              <div className="space-y-2">
                {result.brandFacets.map((b) => (
                  <label key={b.slug} className="flex items-center gap-2 text-sm text-muted">
                    <input type="checkbox" name="brands" value={b.slug} defaultChecked={params.brands.includes(b.slug)} className="accent-accent" />
                    <span className="flex-1">{b.name}</span>
                    <span className="text-xs text-subtle">{b.count}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="label">Fiyat (TL)</legend>
            <div className="flex gap-2">
              <input name="minPrice" type="number" min={0} inputMode="numeric" placeholder="En az" defaultValue={params.minPrice != null ? params.minPrice / 100 : ""} className="input" aria-label="En az fiyat" />
              <input name="maxPrice" type="number" min={0} inputMode="numeric" placeholder="En çok" defaultValue={params.maxPrice != null ? params.maxPrice / 100 : ""} className="input" aria-label="En çok fiyat" />
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="inStock" value="1" defaultChecked={params.inStock} className="accent-accent" />
            Yalnızca stoktakiler
          </label>

          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1">Uygula</button>
            <a href={`${basePath}${params.q ? `?q=${encodeURIComponent(params.q)}` : ""}`} className="btn-ghost">Temizle</a>
          </div>
        </form>
      </aside>

      <section aria-label="Ürünler">
        <p className="mb-4 text-sm text-muted">{result.total} ürün</p>
        <ProductGrid products={result.items} />
        <Pagination page={result.page} pageCount={result.pageCount} hrefFor={(page) => `${basePath}${buildQuery(params, { page })}`} />
      </section>
    </div>
  );
}
