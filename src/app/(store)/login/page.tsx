import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/store/AuthForms";
import { safeRedirectPath } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Giriş", robots: { index: false } };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = safeRedirectPath(sp.next, "");
  if (await getCurrentUser()) redirect(next || "/account");

  return (
    <div className="container-x flex justify-center py-16">
      <div className="card w-full max-w-md p-8">
        <h1 className="slab mb-6 text-3xl">Giriş yap</h1>
        <LoginForm next={next || undefined} />
        <p className="mt-6 text-center text-sm text-muted">
          Hesabın yok mu?{" "}
          <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-accent hover:underline">Kayıt ol</Link>
        </p>
      </div>
    </div>
  );
}
