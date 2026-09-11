import Link from "next/link";
import { getNavCategories } from "@/server/catalog/queries";
import { Logo } from "./Logo";

export async function Footer() {
  const categories = await getNavCategories();
  return (
    <footer className="mt-24 border-t border-line bg-panel">
      <div className="container-x grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted">
            Aracınız için profesyonel detailing ürünleri. Yıkamadan seramik kaplamaya, tek adreste.
          </p>
        </div>
        <div>
          <h3 className="label">Kategoriler</h3>
          <ul className="space-y-2 text-sm">
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={`/categories/${c.slug}`} className="text-muted hover:text-fg">{c.name}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="label">Hesap</h3>
          <ul className="space-y-2 text-sm">
            <li><Link href="/account" className="text-muted hover:text-fg">Hesabım</Link></li>
            <li><Link href="/account/orders" className="text-muted hover:text-fg">Siparişlerim</Link></li>
            <li><Link href="/cart" className="text-muted hover:text-fg">Sepet</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="label">Destek</h3>
          <ul className="space-y-2 text-sm text-muted">
            <li>Kargo ve teslimat</li>
            <li>İade ve değişim</li>
            <li>Mesafeli satış sözleşmesi</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="container-x py-4 text-xs text-subtle">© {new Date().getFullYear()} SLAB STYLE Car Care. Tüm hakları saklıdır.</p>
      </div>
    </footer>
  );
}
