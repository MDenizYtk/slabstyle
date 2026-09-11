import { toneFor } from "@/domain/orders/status";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = toneFor(status);
  return (
    <span
      className={cn(
        "badge whitespace-nowrap",
        tone === "ok" && "bg-ok/15 text-ok",
        tone === "warn" && "bg-warn/15 text-warn",
        tone === "bad" && "bg-bad/15 text-bad",
        tone === "muted" && "bg-panel-2 text-muted",
      )}
    >
      {label ?? status}
    </span>
  );
}
