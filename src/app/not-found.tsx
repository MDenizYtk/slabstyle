import Link from "next/link";
import { LogoMark } from "@/components/store/Logo";

export default function NotFound() {
  return (
    <main className="carbon flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <LogoMark className="h-12 w-12" />
      <h1 className="slab text-6xl">404</h1>
      <p className="text-muted">Aradığın sayfa bulunamadı.</p>
      <Link href="/" className="btn-primary">Ana sayfaya dön</Link>
    </main>
  );
}
