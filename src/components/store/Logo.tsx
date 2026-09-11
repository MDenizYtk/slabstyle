import Link from "next/link";

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="6" fill="#ff5a1f" />
      <path d="M9 27 L21 9 H31 L19 27 Z" fill="#0a0a0b" />
      <path d="M17 31 L23 22 H31 L25 31 Z" fill="#0a0a0b" opacity="0.55" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="SLAB STYLE Car Care ana sayfa">
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="slab text-lg text-fg">SLAB STYLE</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.35em] text-accent">Car Care</span>
      </span>
    </Link>
  );
}
