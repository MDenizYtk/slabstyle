import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";
import { LogoMark } from "@/components/store/Logo";
import { logoutAction } from "@/server/auth/actions";
import { requireStaff } from "@/server/auth/dal";

export const metadata: Metadata = { title: { default: "Admin", template: "%s | Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireStaff("/admin");

  return (
    <div className="flex min-h-full flex-1 flex-col lg:flex-row">
      <aside className="border-b border-line bg-panel p-4 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <Link href="/admin" className="mb-6 flex items-center gap-2">
          <LogoMark className="h-7 w-7" />
          <span className="slab text-sm">SLAB Admin</span>
        </Link>
        <AdminNav />
        <div className="mt-8 hidden border-t border-line pt-4 text-xs text-muted lg:block">
          <p className="font-semibold text-fg">{user.name}</p>
          <p>{user.role}</p>
          <div className="mt-3 flex gap-3">
            <Link href="/" className="hover:text-fg">Mağaza</Link>
            <form action={logoutAction}><button className="hover:text-fg">Çıkış</button></form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-8">{children}</main>
    </div>
  );
}
