/**
 * Toplu fotoğraf yüklemede dosya adından ürün adı çıkarma.
 *
 *   "bmw-f30-sag-far.jpg"      → "Bmw F30 Sağ Far"
 *   "01_audi_a4_stop_lambasi"  → "Audi A4 Stop Lambasi"
 *   "far-2.jpg" / "far (2).jpg"→ gruplama anahtarı "far" (aynı ürünün 2. fotoğrafı)
 */

const stripExtension = (filename: string) => filename.replace(/\.[a-z0-9]{2,5}$/i, "");

function titleCaseTr(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1).toLocaleLowerCase("tr"))
    .join(" ");
}

/** Dosya adından gösterilecek ürün adı. Sondaki sıra numarası korunur. */
export function productNameFromFilename(filename: string): string {
  const cleaned = stripExtension(filename)
    .replace(/^\d{1,3}[\s._-]+/, "") // baştaki "01 - " gibi sıra numarası
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const name = titleCaseTr(cleaned).slice(0, 120);
  return name || "Ürün";
}

/** Aynı ürünün fotoğraflarını birleştirmek için: sondaki sayaç atılmış ad. */
export function groupNameFromFilename(filename: string): string {
  const withoutCounter = stripExtension(filename)
    .replace(/^\d{1,3}[\s._-]+/, "")
    .replace(/\s*\(\d{1,3}\)\s*$/, "") // "far (2)"
    .replace(/[\s._-]+\d{1,3}$/, "") // "far-2", "far_02"
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const name = titleCaseTr(withoutCounter).slice(0, 120);
  return name || productNameFromFilename(filename);
}

/** Karşılaştırma anahtarı: büyük/küçük harf ve noktalama farkını yok sayar. */
export function groupKeyFromFilename(filename: string): string {
  return groupNameFromFilename(filename)
    .toLocaleLowerCase("tr")
    .replace(/[^a-z0-9çğıöşü]/g, "");
}
