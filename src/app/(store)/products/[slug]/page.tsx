import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/store/AddToCart";
import { ContactCTA } from "@/components/store/ContactCTA";
import { isShop } from "@/config/mode";
import { formatMoney } from "@/lib/money";
import { db } from "@/server/db";
import { DEFAULT_CONTACT, getContactSettings } from "@/server/settings";
import { ProductGrid } from "@/components/store/ProductCard";
import { ProductImage } from "@/components/store/ProductImage";
import { getProductBySlug, getRelatedProducts } from "@/server/catalog/queries";

export async function generateMetadata(props: PageProps<"/products/[slug]">): Promise<Metadata> {
  const product = await getProductBySlug((await props.params).slug);
  if (!product) return {};
  return {
    title: product.seoTitle ?? product.name,
    description: product.seoDescription ?? product.shortDesc ?? undefined,
    openGraph: { images: product.images[0] ? [product.images[0].url] : [] },
  };
}

export default async function ProductPage(props: PageProps<"/products/[slug]">) {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const [related, contact] = await Promise.all([getRelatedProducts(slug), isShop ? Promise.resolve(DEFAULT_CONTACT) : getContactSettings(db)]);
  const [mainImage, ...otherImages] = product.images;
  const price = product.variants.find((v) => v.price != null)?.price ?? null;

  return (
    <div className="container-x py-10">
      <nav className="mb-6 text-xs text-subtle" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-fg">Ana sayfa</Link>
        {product.breadcrumbs.map((b) => (
          <span key={b.href}>
            {" / "}
            <Link href={b.href} className="hover:text-fg">{b.name}</Link>
          </span>
        ))}
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="card relative aspect-square overflow-hidden">
            <ProductImage src={mainImage?.url ?? null} alt={mainImage?.alt ?? product.name} sizes="(min-width: 1024px) 50vw, 100vw" priority />
          </div>
          {otherImages.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {otherImages.map((img) => (
                <div key={img.url} className="card relative aspect-square overflow-hidden">
                  <ProductImage src={img.url} alt={img.alt} sizes="12vw" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          {product.brand && (
            <Link href={`/products?brands=${product.brand.slug}`} className="text-xs font-bold uppercase tracking-[0.3em] text-accent">
              {product.brand.name}
            </Link>
          )}
          <h1 className="slab mt-2 text-3xl sm:text-4xl">{product.name}</h1>
          {product.shortDesc && <p className="mt-4 text-muted">{product.shortDesc}</p>}

          <div className="card mt-8 space-y-4 p-6">
            {isShop ? (
              <AddToCart variants={product.variants} />
            ) : (
              <>
                {price != null && (
                  <div className="flex items-end gap-3">
                    <span className="text-3xl font-bold">{formatMoney(price)}</span>
                    <span className="pb-1 text-xs text-subtle">KDV dahil</span>
                  </div>
                )}
                {product.variants.length > 1 && (
                  <p className="text-sm text-muted">Seçenekler: {product.variants.map((v) => v.name).join(" · ")}</p>
                )}
                <ContactCTA contact={contact} productName={product.name} />
              </>
            )}
          </div>

          <ul className="mt-6 grid grid-cols-3 gap-3 text-center text-xs text-muted">
            <li className="card p-3">Orijinal ürün</li>
            <li className="card p-3">Hızlı teslimat</li>
            <li className="card p-3">Uzman desteği</li>
          </ul>
        </div>
      </div>

      <div className="mt-16 grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        {product.description && (
          <section aria-labelledby="desc-title">
            <h2 id="desc-title" className="slab mb-4 text-2xl">Açıklama</h2>
            <div className="space-y-3 whitespace-pre-line leading-relaxed text-muted">{product.description}</div>
          </section>
        )}
        {product.specs.length > 0 && (
          <section aria-labelledby="spec-title">
            <h2 id="spec-title" className="slab mb-4 text-2xl">Teknik özellikler</h2>
            <dl className="card divide-y divide-line">
              {product.specs.map((s) => (
                <div key={s.label} className="flex justify-between gap-4 px-4 py-3 text-sm">
                  <dt className="text-muted">{s.label}</dt>
                  <dd className="text-right font-medium">{s.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      {related.length > 0 && (
        <section className="mt-16" aria-labelledby="related-title">
          <h2 id="related-title" className="slab mb-6 text-2xl">Benzer ürünler</h2>
          <ProductGrid products={related} />
        </section>
      )}
    </div>
  );
}
