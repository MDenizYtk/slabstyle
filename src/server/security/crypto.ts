import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";
const VERSION = "v1";

function resolveKey(keyB64?: string): Buffer {
  const raw = keyB64 ?? process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY tanımlı değil");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY 32 bayt olmalı");
  return key;
}

/**
 * Tedarikçi API anahtarı gibi gizli verileri şifreler.
 * Çıktı biçimi: v1.<iv>.<authTag>.<ciphertext> (base64url)
 */
export function encryptSecret(plaintext: string, keyB64?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, resolveKey(keyB64), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(payload: string, keyB64?: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error("Geçersiz şifreli veri biçimi");
  }
  const decipher = createDecipheriv(ALGO, resolveKey(keyB64), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
