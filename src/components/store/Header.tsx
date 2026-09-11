import Link from "next/link";
import { getCurrentUser, isStaff } from "@/server/auth/dal";
import { getCartCount } from "@/server/cart/service";
import { getNavCategories } from "@/server/catalog/queries";
import { Logo } from "./Logo";

export async function Header() {
  const [user, cartCount, categories] = await Promise.all([getCurrentUser(), getCartCount(), getNavCategories()]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/90 backdrop-blur">
      <div className="border-b border-line/60 bg-panel text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
        <p className="container-x py-1.5">750 TL üzeri standart kargo ücretsiz</p>
      </div>

      <div className="container-x flex items-center gap-4 py-3">
        <Logo />

        <form action="/search" method="get" role="search" className="order-last w-full sm:order-none sm:flex-1">
          <label htmlFor="site-search" className="sr-only">Ürün ara</label>
          <input
            id="site-search"
            name="q"
            type="search"
            placeholder="Ürün, marka, barkod ara…"
            className="input"
            autoComplete="off"
          />
        </form>

        <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="Hesap">
          {user && isStaff(user) && (
            <Link href="/admin" className="btn-ghost hidden sm:inline-flex">Admin</Link>
          )}
          <Link href={user ? "/account" : "/login"} className="btn-ghost">
            {user ? "Hesabım" : "Giriş"}
          </Link>
          <Link href="/cart" className="btn-secondary" aria-label={`Sepet, ${cartCount} ürün`}>
            Sepet
            <span className="rounded bg-accent px-1.5 text-xs font-bold text-black">{cartCount}</span>
          </Link>
        </nav>
      </div>

      <nav className="container-x flex gap-1 overflow-x-auto pb-2 text-sm" aria-label="Kategoriler">
        <Link href="/products" className="whitespace-nowrap rounded px-3 py-1.5 font-semibold text-fg hover:bg-panel-2">
          Tüm Ürünler
        </Link>
        {categories.map((c) => (
          <Link key={c.id} href={`/categories/${c.slug}`} className="whitespace-nowrap rounded px-3 py-1.5 text-muted hover:bg-panel-2 hover:text-fg">
            {c.name}
          </Link>
        ))}
      </nav>
    </header>
  );
}
