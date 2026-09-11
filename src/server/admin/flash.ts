import { redirect } from "next/navigation";

/**
 * Admin formlarında işlem sonucunu URL üzerinden bildirir (PRG deseni).
 * Mesaj React tarafından metin olarak basılır; HTML yorumlanmaz.
 */
export function redirectWithFlash(path: string, message: string, tone: "ok" | "bad" = "ok"): never {
  const url = new URL(path, "http://x");
  url.searchParams.set("flash", message.slice(0, 300));
  url.searchParams.set("tone", tone);
  redirect(`${url.pathname}${url.search}`);
}

export function readFlash(sp: Record<string, string | string[] | undefined>) {
  const message = typeof sp.flash === "string" ? sp.flash : null;
  const tone: "ok" | "bad" = sp.tone === "bad" ? "bad" : "ok";
  return { message, tone };
}
