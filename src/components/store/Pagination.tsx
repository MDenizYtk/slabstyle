import Link from "next/link";
import { cn } from "@/lib/utils";

export function Pagination({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (page: number) => string }) {
  if (pageCount <= 1) return null;

  const pages = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const sorted = [...pages].sort((a, b) => a - b);

  return (
    <nav className="mt-10 flex items-center justify-center gap-1" aria-label="Sayfalama">
      {page > 1 && <Link href={hrefFor(page - 1)} className="btn-ghost" rel="prev">Önceki</Link>}
      {sorted.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && sorted[i - 1] !== p - 1 && <span className="px-1 text-subtle">…</span>}
          <Link
            href={hrefFor(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn("btn min-w-10", p === page ? "bg-accent text-black" : "text-muted hover:bg-panel-2")}
          >
            {p}
          </Link>
        </span>
      ))}
      {page < pageCount && <Link href={hrefFor(page + 1)} className="btn-ghost" rel="next">Sonraki</Link>}
    </nav>
  );
}
