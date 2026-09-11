/**
 * GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) doğrulama ve normalizasyon.
 * Karşılaştırmalar her zaman 14 haneye tamamlanmış biçim üzerinden yapılır;
 * böylece UPC-A "012345678905" ile EAN-13 "0012345678905" aynı ürün sayılır.
 */

export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const code = raw.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** Geçerli GTIN'i 14 haneye tamamlar; geçersizse null döner. */
export function normalizeGtin(raw: string | null | undefined): string | null {
  if (!isValidGtin(raw)) return null;
  return raw!.replace(/[\s-]/g, "").padStart(14, "0");
}

/** Gövdeye kontrol hanesi ekleyerek geçerli EAN-13 üretir (fixture/test amaçlı). */
export function makeEan13(body12: string): string {
  if (!/^\d{12}$/.test(body12)) throw new Error("EAN-13 gövdesi 12 hane olmalı");
  return body12 + gtinCheckDigit(body12);
}
