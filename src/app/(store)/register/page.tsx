import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/store/AuthForms";
import { safeRedirectPath } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Kayıt ol", robots: { index: false } };

export default async function RegisterPage(props: PageProps<"/register">) {
  const next = safeRedirectPath((await props.searchParams).next, "");
  if (await getCurrentUser()) redirect(next || "/account");

  return (
    <div className="container-x flex justify-center py-16">
      <div className="card w-full max-w-md p-8">
        <h1 className="slab mb-6 text-3xl">Hesap oluştur</h1>
        <RegisterForm next={next || undefined} />
        <p className="mt-6 text-center text-sm text-muted">
          Zaten üye misin?{" "}
          <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-accent hover:underline">Giriş yap</Link>
        </p>
      </div>
    </div>
  );
}
