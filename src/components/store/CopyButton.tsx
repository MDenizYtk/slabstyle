"use client";

import { useState } from "react";

export function CopyButton({ value, label = "Kopyala" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost px-2 py-1 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Pano izni yoksa kullanıcı metni elle seçebilir.
        }
      }}
    >
      {copied ? "Kopyalandı" : label}
    </button>
  );
}
