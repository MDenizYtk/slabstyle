import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteProductButton } from "@/components/admin/DeleteProductButton";
import { Flash, PageHeader } from "@/components/admin/ui";
import { isShop } from "@/config/mode";
import { ProductImage } from "@/components/store/ProductImage";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatMoney } from "@/lib/money";
import { readFlash } from "@/server/admin/flash";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";
import { recalculateProductAction, setVariantPriceAction, updateProductAction } from "@/server/catalog/admin-actions";
import { OWN_STOCK_CODE } from "@/server/catalog/own-stock";
import {
  addImagesAction,
  addVariantAction,
  deleteImageAction,
  makePrimaryImageAction,
  setOwnStockAction,
  updateVariantAction,
} from "@/server/catalog/product-admin";
import { unmatchAction } from "@/server/matching/admin-actions";

export const metadata = { title: "Ürün düzenle" };

const tl = (minor: number | null | undefined) => (minor == null ? "" : (minor / 100).toFixed(2).replace(".", ","));

export default async function AdminProductPage(props: PageProps<"/admin/products/[id]">) {
  const user = await requireStaff();
  const { id } = await props.params;
  const flash = readFlash(await props.searchParams);

  const [product, categories, brands] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { position: "asc" } },
        variants: {
          orderBy: { position: "asc" },
          include: {
            price: { include: { pricingRule: { select: { name: true } } } },
            inventory: true,
            supplierProducts: {
              orderBy: { costPrice: "asc" },
              select: { id: true, supplierSku: true, costPrice: true, stock: true, status: true, matchMethod: true, supplier: { select: { name: true, code: true, status: true, safetyStock: true } } },
            },
          },
        },
      },
    }),
    db.category.findMany({ orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { position: "asc" }], select: { id: true, name: true, parent: { select: { name: true } } } }),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!product) notFound();

  const specsText = Array.isArray(product.specs)
    ? product.specs.map((s) => (s && typeof s === "object" && "label" in s && "value" in s ? `${s.label}: ${s.value}` : "")).filter(Boolean).join("\n")
    : "";

  return (
    <>
      <Link href="/admin/products" className="text-sm text-muted hover:text-fg">← Ürünler</Link>
      <PageHeader
        title={product.name}
        description={`/${product.slug}`}
        actions={
          <>
            {product.status === "ACTIVE" && <Link href={`/products/${product.slug}`} className="btn-ghost" target="_blank">Mağazada gör</Link>}
            <form action={recalculateProductAction}>
              <input type="hidden" name="productId" value={product.id} />
              <button className="btn-secondary">Yeniden hesapla</button>
            </form>
            {user.role === "ADMIN" && <DeleteProductButton productId={product.id} name={product.name} className="btn-danger" />}
          </>
        }
      />
      <Flash message={flash.message} tone={flash.tone} />

      <section className="card mb-6 space-y-3 p-5" aria-labelledby="photos">
        <h2 id="photos" className="font-semibold">Fotoğraflar ({product.images.length})</h2>
        {product.images.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
            {product.images.map((img, i) => (
              <div key={img.id} className="space-y-1">
                <div className={`relative aspect-square overflow-hidden rounded-lg bg-panel-2 ${i === 0 ? "ring-2 ring-accent" : ""}`}>
                  <ProductImage src={img.url} alt={img.alt ?? product.name} sizes="120px" />
                </div>
                <div className="flex justify-between text-[11px]">
                  {i === 0 ? (
                    <span className="text-accent">Ana</span>
                  ) : (
                    <form action={makePrimaryImageAction}>
                      <input type="hidden" name="imageId" value={img.id} />
                      <button className="text-muted hover:text-fg">Ana yap</button>
                    </form>
                  )}
                  <form action={deleteImageAction}>
                    <input type="hidden" name="imageId" value={img.id} />
                    <button className="text-muted hover:text-bad">Sil</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
        <form action={addImagesAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="productId" value={product.id} />
          <input name="images" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple required className="input max-w-md" aria-label="Fotoğraf seç" />
          <button className="btn-secondary">Fotoğraf yükle</button>
          <span className="text-xs text-subtle">JPG/PNG/WEBP/AVIF, her biri en fazla 5 MB</span>
        </form>
      </section>

      <form action={updateProductAction} className="card grid gap-4 p-5 md:grid-cols-2">
        <input type="hidden" name="id" value={product.id} />
        <div className="md:col-span-2">
          <label className="label" htmlFor="name">Ad</label>
          <input id="name" name="name" defaultValue={product.name} className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="slug">URL (slug)</label>
          <input id="slug" name="slug" defaultValue={product.slug} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="status">Durum</label>
          <select id="status" name="status" defaultValue={product.status} className="input">
            <option value="DRAFT">Taslak</option>
            <option value="ACTIVE">Yayında</option>
            <option value="ARCHIVED">Arşiv</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="categoryId">Kategori</label>
          <select id="categoryId" name="categoryId" defaultValue={product.categoryId ?? ""} className="input">
            <option value="">—</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.parent ? `${c.parent.name} › ` : ""}{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="brandId">Marka</label>
          <select id="brandId" name="brandId" defaultValue={product.brandId ?? ""} className="input">
            <option value="">—</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="shortDesc">Kısa açıklama</label>
          <input id="shortDesc" name="shortDesc" defaultValue={product.shortDesc ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="description">Açıklama</label>
          <textarea id="description" name="description" rows={8} defaultValue={product.description ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="specs">Teknik özellikler (her satır &quot;Etiket: Değer&quot;)</label>
          <textarea id="specs" name="specs" rows={8} defaultValue={specsText} className="input font-mono text-xs" />
        </div>
        <div>
          <label className="label" htmlFor="seoTitle">SEO başlık</label>
          <input id="seoTitle" name="seoTitle" defaultValue={product.seoTitle ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="seoDescription">SEO açıklama</label>
          <input id="seoDescription" name="seoDescription" defaultValue={product.seoDescription ?? ""} className="input" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="isFeatured" defaultChecked={product.isFeatured} className="accent-accent" /> Popüler ürünlerde göster
        </label>
        <div className="md:col-span-2"><button className="btn-primary">Kaydet</button></div>
      </form>

      <h2 className="slab mb-3 mt-8 text-xl">Varyantlar, ürün kodları, fiyat ve stok</h2>
      <div className="space-y-4">
        {product.variants.map((v) => {
          const own = v.supplierProducts.find((sp) => sp.supplier.code === OWN_STOCK_CODE);
          return (
            <section key={v.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <form action={updateVariantAction} className="grid flex-1 gap-2 sm:grid-cols-[1.2fr_1.2fr_1.2fr_1fr_auto_auto]">
                  <input type="hidden" name="variantId" value={v.id} />
                  <input type="hidden" name="productId" value={product.id} />
                  <div><label className="label" htmlFor={`vn-${v.id}`}>Seçenek</label><input id={`vn-${v.id}`} name="name" defaultValue={v.name} className="input" /></div>
                  <div><label className="label" htmlFor={`vs-${v.id}`}>Ürün kodu</label><input id={`vs-${v.id}`} name="sku" defaultValue={v.sku} className="input font-mono" /></div>
                  <div><label className="label" htmlFor={`vg-${v.id}`}>Barkod</label><input id={`vg-${v.id}`} name="gtin" defaultValue={v.gtin ?? ""} className="input font-mono" /></div>
                  <div><label className="label" htmlFor={`vm-${v.id}`}>Üretici kodu</label><input id={`vm-${v.id}`} name="mpn" defaultValue={v.mpn ?? ""} className="input font-mono" /></div>
                  <label className="flex items-end gap-1 pb-3 text-xs text-muted"><input type="checkbox" name="isActive" defaultChecked={v.isActive} className="accent-accent" /> Satışta</label>
                  <div className="flex items-end"><button className="btn-secondary text-xs">Kaydet</button></div>
                </form>
                <div className="text-right text-sm">
                  <p className="text-lg font-bold">{v.price ? formatMoney(v.price.amount) : "Fiyat yok"}</p>
                  <p className="text-xs text-muted">
                    Maliyet {v.price?.costAmount != null ? formatMoney(v.price.costAmount) : "—"} · Kâr {v.price?.costAmount != null ? formatMoney(v.price.amount - v.price.costAmount) : "—"}
                    {v.price?.manualAmount != null ? " · Elle fiyat" : ` · Kural: ${v.price?.pricingRule?.name ?? "varsayılan"}`}
                  </p>
                  {isShop && (
                    <p className="text-xs text-muted">Satılabilir {v.inventory?.availableQty ?? 0} · Rezerve {v.inventory?.reservedQty ?? 0} · Tedarikçi toplamı {v.inventory?.supplierQty ?? 0}</p>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-3 border-t border-line pt-3 lg:grid-cols-2">
                {user.role === "ADMIN" && (
                  <form action={setVariantPriceAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="variantId" value={v.id} />
                    <input type="hidden" name="productId" value={product.id} />
                    <div><label className="label" htmlFor={`m-${v.id}`}>Satış fiyatı (TL, boş = kural)</label><input id={`m-${v.id}`} name="manualAmount" defaultValue={tl(v.price?.manualAmount)} className="input w-36" inputMode="decimal" /></div>
                    <div><label className="label" htmlFor={`c-${v.id}`}>Üstü çizili (TL)</label><input id={`c-${v.id}`} name="compareAtAmount" defaultValue={tl(v.price?.compareAtAmount)} className="input w-36" inputMode="decimal" /></div>
                    <button className="btn-secondary text-xs">Fiyatı kaydet</button>
                  </form>
                )}
                {isShop && (
                  <form action={setOwnStockAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="variantId" value={v.id} />
                    <input type="hidden" name="productId" value={product.id} />
                    <div><label className="label" htmlFor={`oc-${v.id}`}>Kendi stoğum · maliyet (TL)</label><input id={`oc-${v.id}`} name="cost" defaultValue={tl(own?.costPrice)} className="input w-36" inputMode="decimal" /></div>
                    <div><label className="label" htmlFor={`os-${v.id}`}>Adet</label><input id={`os-${v.id}`} name="stock" type="number" min={0} defaultValue={own?.stock ?? ""} className="input w-24" /></div>
                    <button className="btn-secondary text-xs">Stoğu kaydet</button>
                  </form>
                )}
              </div>

              <div className={`mt-3 overflow-x-auto ${isShop ? "" : "hidden"}`}>
                <table className="table-x">
                  <thead><tr><th>Tedarikçi</th><th>Tedarikçi SKU</th><th className="text-right">Alış</th><th className="text-right">Stok</th><th>Durum</th><th>Eşleşme</th><th /></tr></thead>
                  <tbody>
                    {v.supplierProducts.length === 0 && <tr><td colSpan={7} className="text-center text-muted">Bu varyanta bağlı tedarikçi teklifi veya kendi stok kaydı yok</td></tr>}
                    {v.supplierProducts.map((sp) => (
                      <tr key={sp.id} className={sp.id === v.price?.supplierProductId ? "bg-accent/5" : ""}>
                        <td>{sp.supplier.name} {sp.id === v.price?.supplierProductId && <span className="badge ml-1 bg-accent/15 text-accent">Seçili</span>}</td>
                        <td className="font-mono text-xs">{sp.supplierSku}</td>
                        <td className="text-right">{formatMoney(sp.costPrice)}</td>
                        <td className="text-right">{sp.stock} <span className="text-xs text-subtle">(-{sp.supplier.safetyStock})</span></td>
                        <td><StatusBadge status={sp.status} /></td>
                        <td className="text-xs">{sp.matchMethod ?? "—"}</td>
                        <td>
                          {sp.supplier.code !== OWN_STOCK_CODE && (
                            <form action={unmatchAction}>
                              <input type="hidden" name="supplierProductId" value={sp.id} />
                              <input type="hidden" name="variantId" value={v.id} />
                              <input type="hidden" name="productId" value={product.id} />
                              <button className="btn-ghost text-xs">Eşleşmeyi kaldır</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      <form action={addVariantAction} className="card mt-4 grid gap-2 p-4 sm:grid-cols-4 lg:grid-cols-8">
        <input type="hidden" name="productId" value={product.id} />
        <p className="font-semibold sm:col-span-4 lg:col-span-8">Yeni varyant ekle</p>
        <input name="variantName" placeholder="Seçenek (ör. 1 L)" className="input" required aria-label="Seçenek adı" />
        <input name="variantSku" placeholder="Ürün kodu" className="input font-mono" aria-label="Ürün kodu" />
        <input name="variantGtin" placeholder="Barkod" className="input font-mono" aria-label="Barkod" />
        <input name="variantMpn" placeholder="Üretici kodu" className="input font-mono" aria-label="Üretici kodu" />
        <input name="variantPrice" placeholder="Satış TL" inputMode="decimal" className="input" aria-label="Satış fiyatı" />
        <input name="variantCost" placeholder="Maliyet TL" inputMode="decimal" className="input" aria-label="Maliyet" />
        <input name="variantStock" type="number" min={0} placeholder="Stok" className="input" aria-label="Stok" />
        <input type="hidden" name="variantCompareAt" value="" />
        <button className="btn-secondary">Ekle</button>
      </form>
    </>
  );
}
