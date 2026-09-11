import Link from "next/link";
import { connection } from "next/server";
import { ProductGrid } from "@/components/store/ProductCard";
import { campaigns } from "@/content/campaigns";
import { getHomeData, getNavCategories } from "@/server/catalog/queries";

export default async function HomePage() {
  await connection(); // güncel fiyat/stok: istek anında oluşturulur (layout ile paralel çalışır)
  const [{ featured, newest, deals, brands }, categories] = await Promise.all([getHomeData(), getNavCategories()]);

  return (
    <>
      <section className="carbon border-b border-line">
        <div className="container-x grid gap-10 py-16 sm:py-24 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.35em] text-accent">Profesyonel detailing</p>
            <h1 className="slab text-5xl sm:text-7xl">
              Aracın
              <br />
              <span className="text-accent">ayna gibi</span>
              <br />
              parlasın.
            </h1>
            <p className="mt-6 max-w-lg text-lg text-muted">
              Yıkamadan seramik kaplamaya, iç temizlikten polisaj makinelerine kadar ihtiyacın olan her şey tek sepette.
            </p>
            <form action="/search" className="mt-8 flex max-w-lg gap-2">
              <label htmlFor="hero-search" className="sr-only">Ürün ara</label>
              <input id="hero-search" name="q" type="search" placeholder="Ör. seramik sprey, pasta, mikrofiber" className="input" />
              <button className="btn-primary">Ara</button>
            </form>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {categories.slice(0, 4).map((c, i) => (
              <Link
                key={c.id}
                href={`/categories/${c.slug}`}
                className={`card group flex min-h-32 flex-col justify-end p-4 transition-colors hover:border-accent ${i === 0 ? "bg-accent text-black" : ""}`}
              >
                <span className={`slab text-lg ${i === 0 ? "" : "group-hover:text-accent"}`}>{c.name}</span>
                <span className={`text-xs ${i === 0 ? "text-black/70" : "text-subtle"}`}>Keşfet</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="container-x space-y-20 py-16">
        <section aria-labelledby="cat-title">
          <h2 id="cat-title" className="slab mb-6 text-3xl">Kategoriler</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map((c) => (
              <Link key={c.id} href={`/categories/${c.slug}`} className="card p-4 text-sm font-semibold transition-colors hover:border-accent hover:text-accent">
                {c.name}
              </Link>
            ))}
          </div>
        </section>

        {featured.length > 0 && (
          <section aria-labelledby="popular-title">
            <div className="mb-6 flex items-end justify-between">
              <h2 id="popular-title" className="slab text-3xl">Popüler ürünler</h2>
              <Link href="/products" className="text-sm text-accent hover:underline">Tümünü gör</Link>
            </div>
            <ProductGrid products={featured} />
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-2" aria-label="Kampanyalar">
          {campaigns.map((c) => (
            <Link key={c.id} href={c.href} className="carbon card group flex flex-col gap-3 p-8 transition-colors hover:border-accent">
              <span className="text-xs font-bold uppercase tracking-[0.3em] text-accent">{c.eyebrow}</span>
              <span className="slab text-3xl">{c.title}</span>
              <span className="text-muted">{c.body}</span>
              <span className="mt-2 text-sm font-semibold text-fg group-hover:text-accent">{c.cta} →</span>
            </Link>
          ))}
        </section>

        {deals.length > 0 && (
          <section aria-labelledby="deals-title">
            <h2 id="deals-title" className="slab mb-6 text-3xl">İndirimdekiler</h2>
            <ProductGrid products={deals} />
          </section>
        )}

        <section aria-labelledby="new-title">
          <div className="mb-6 flex items-end justify-between">
            <h2 id="new-title" className="slab text-3xl">Yeni gelenler</h2>
            <Link href="/products?sort=newest" className="text-sm text-accent hover:underline">Tümünü gör</Link>
          </div>
          <ProductGrid products={newest} />
        </section>

        {brands.length > 0 && (
          <section aria-labelledby="brand-title">
            <h2 id="brand-title" className="slab mb-6 text-3xl">Markalar</h2>
            <div className="flex flex-wrap gap-2">
              {brands.map((b) => (
                <Link key={b.slug} href={`/products?brands=${b.slug}`} className="btn-secondary">{b.name}</Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
