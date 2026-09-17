import Link from "next/link";
import { isShop } from "@/config/mode";
import { getNavCategories } from "@/server/catalog/queries";
import { db } from "@/server/db";
import { getContactSettings } from "@/server/settings";
import { Logo } from "./Logo";
import { normalizeWhatsapp } from "./ContactCTA";

export async function Footer() {
  const [categories, contact] = await Promise.all([getNavCategories(), getContactSettings(db)]);
  const wa = normalizeWhatsapp(contact.whatsapp);

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
          <h3 className="label">İletişim</h3>
          <ul className="space-y-2 text-sm text-muted">
            {wa && <li><a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="hover:text-fg">WhatsApp</a></li>}
            {contact.phone && <li><a href={`tel:${contact.phone.replace(/\s/g, "")}`} className="hover:text-fg">{contact.phone}</a></li>}
            {contact.email && <li><a href={`mailto:${contact.email}`} className="hover:text-fg">{contact.email}</a></li>}
            {contact.address && <li>{contact.address}</li>}
          </ul>
        </div>
        <div>
          <h3 className="label">{isShop ? "Hesap" : "Keşfet"}</h3>
          <ul className="space-y-2 text-sm">
            {isShop ? (
              <>
                <li><Link href="/account" className="text-muted hover:text-fg">Hesabım</Link></li>
                <li><Link href="/account/orders" className="text-muted hover:text-fg">Siparişlerim</Link></li>
                <li><Link href="/cart" className="text-muted hover:text-fg">Sepet</Link></li>
              </>
            ) : (
              <>
                <li><Link href="/products" className="text-muted hover:text-fg">Tüm ürünler</Link></li>
                <li><Link href="/search" className="text-muted hover:text-fg">Arama</Link></li>
              </>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="container-x py-4 text-xs text-subtle">© {new Date().getFullYear()} SLAB STYLE Car Care. Tüm hakları saklıdır.</p>
      </div>
    </footer>
  );
}
