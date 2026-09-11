import Link from "next/link";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="slab text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone, href }: { label: string; value: string | number; hint?: string; tone?: "warn" | "bad" | "ok"; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-2 text-2xl font-bold", tone === "warn" && "text-warn", tone === "bad" && "text-bad", tone === "ok" && "text-ok")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 transition-colors hover:border-accent/60">{body}</Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

export function EmptyRow({ colSpan, text = "Kayıt yok" }: { colSpan: number; text?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 text-center text-muted">{text}</td>
    </tr>
  );
}

export function Flash({ message, tone = "ok" }: { message?: string | null; tone?: "ok" | "bad" }) {
  if (!message) return null;
  return (
    <p role="status" className={cn("mb-4 rounded-md border p-3 text-sm", tone === "ok" ? "border-ok/40 bg-ok/10 text-ok" : "border-bad/40 bg-bad/10 text-bad")}>
      {message}
    </p>
  );
}
