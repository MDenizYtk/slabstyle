"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/products", label: "Ürünler" },
  { href: "/admin/categories", label: "Kategoriler" },
  { href: "/admin/matching", label: "Eşleştirme" },
  { href: "/admin/pricing", label: "Fiyat kuralları" },
  { href: "/admin/suppliers", label: "Tedarikçiler" },
  { href: "/admin/orders", label: "Siparişler" },
  { href: "/admin/returns", label: "İadeler" },
  { href: "/admin/sync", label: "Senkronizasyon" },
  { href: "/admin/webhooks", label: "Webhooklar" },
  { href: "/admin/settings", label: "Ayarlar" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Admin menü">
      {LINKS.map((l) => {
        const active = l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-2 text-sm",
              active ? "bg-accent text-black font-semibold" : "text-muted hover:bg-panel-2 hover:text-fg",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
