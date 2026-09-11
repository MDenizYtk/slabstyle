import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomToken } from "./security/crypto";

/**
 * Dosya depolama (ürün fotoğrafları). Şimdilik yerel disk; üretimde birden fazla
 * sunucu olacaksa S3 uyumlu bir depoya taşınır — yalnızca bu dosya değişir.
 * Dosyalar public/ dışında tutulur ve /media/... route'u üzerinden sunulur.
 */

// Yol çalışma zamanında belirlenir; derleyicinin (Turbopack) tüm projeyi izlemesi engellenir.
const ROOT = process.env.UPLOAD_DIR
  ? path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR)
  : path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "uploads");
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_UPLOAD = 10;

type ImageKind = { mime: string; ext: "jpg" | "png" | "webp" | "avif" };

/** Uzantıya değil dosyanın ilk baytlarına bakarak tür tespiti (sahte uzantıya karşı). */
export function detectImage(buf: Uint8Array): ImageKind | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.slice(from, to));
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf[0] === 0x89 && ascii(1, 4) === "PNG") return { mime: "image/png", ext: "png" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (ascii(4, 12) === "ftypavif") return { mime: "image/avif", ext: "avif" };
  return null;
}

export const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" };

export class UploadError extends Error {}

export async function saveImage(file: File, folder: string): Promise<string> {
  if (file.size === 0) throw new UploadError("Boş dosya");
  if (file.size > MAX_IMAGE_BYTES) throw new UploadError(`"${file.name}" 5 MB'tan büyük`);
  const buf = new Uint8Array(await file.arrayBuffer());
  const kind = detectImage(buf);
  if (!kind) throw new UploadError(`"${file.name}" desteklenmeyen biçim (JPG, PNG, WEBP, AVIF)`);
  if (!/^[a-z0-9/-]+$/.test(folder)) throw new UploadError("Geçersiz klasör");

  const key = `${folder}/${randomToken(12)}.${kind.ext}`;
  const target = path.join(/* turbopackIgnore: true */ ROOT, key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ target, buf);
  return `/media/${key}`;
}

function keyToPath(key: string): string | null {
  if (!/^[A-Za-z0-9/_-]+\.(jpg|png|webp|avif)$/.test(key) || key.includes("..")) return null;
  const full = path.resolve(/* turbopackIgnore: true */ ROOT, key);
  return full.startsWith(ROOT + path.sep) ? full : null;
}

export async function readMedia(key: string): Promise<{ data: Buffer; mime: string } | null> {
  const full = keyToPath(key);
  if (!full) return null;
  try {
    return { data: await readFile(/* turbopackIgnore: true */ full), mime: MIME_BY_EXT[full.split(".").pop()!] };
  } catch {
    return null;
  }
}

/** Yalnızca bizim yüklediğimiz (/media/...) dosyalar silinir; tedarikçi URL'lerine dokunulmaz. */
export async function deleteMedia(url: string): Promise<void> {
  if (!url.startsWith("/media/")) return;
  const full = keyToPath(url.slice("/media/".length));
  if (full) await unlink(/* turbopackIgnore: true */ full).catch(() => undefined);
}
