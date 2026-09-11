/** Türkiye IBAN doğrulama (TR + 24 hane, ISO 13616 mod-97 kontrolü). */

export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidTrIban(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const iban = normalizeIban(raw);
  if (!/^TR\d{24}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return BigInt(numeric) % BigInt(97) === BigInt(1);
}

/** "TR33 0006 1005 1978 6457 8413 26" biçimi. */
export function formatIban(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})/g, "$1 ").trim();
}
