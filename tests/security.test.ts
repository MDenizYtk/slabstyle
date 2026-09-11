import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, randomToken, safeEqual, sha256Hex } from "@/server/security/crypto";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { loginSchema, registerSchema } from "@/server/auth/validation";
import { redact } from "@/server/logger";
import { safeRedirectPath, slugify } from "@/lib/utils";

describe("şifreleme", () => {
  it("gizli veri şifrelenir ve çözülür", () => {
    const enc = encryptSecret('{"apiKey":"abc123"}');
    expect(enc).not.toContain("abc123");
    expect(decryptSecret(enc)).toBe('{"apiKey":"abc123"}');
  });
  it("her şifreleme farklı çıktı üretir (rastgele IV)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("değiştirilmiş veri reddedilir", () => {
    const enc = encryptSecret("secret");
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
  it("yanlış anahtar reddedilir", () => {
    const enc = encryptSecret("secret");
    expect(() => decryptSecret(enc, Buffer.alloc(32, 1).toString("base64"))).toThrow();
  });
  it("token ve hash yardımcıları", () => {
    expect(randomToken(32)).toHaveLength(43);
    expect(sha256Hex("a")).toHaveLength(64);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });
});

describe("parola", () => {
  it("argon2id hash ve doğrulama", async () => {
    const hash = await hashPassword("GucluSifre123");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "GucluSifre123")).toBe(true);
    expect(await verifyPassword(hash, "yanlis")).toBe(false);
  });
  it("bozuk hash false döner, hata fırlatmaz", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

describe("doğrulama", () => {
  it("e-posta normalize edilir", () => {
    expect(loginSchema.parse({ email: "  Demo@Example.COM ", password: "x" }).email).toBe("demo@example.com");
  });
  it("zayıf parola reddedilir", () => {
    const r = registerSchema.safeParse({ name: "Ali", email: "a@b.co", password: "kisa", passwordConfirm: "kisa" });
    expect(r.success).toBe(false);
  });
  it("parolalar eşleşmeli", () => {
    const r = registerSchema.safeParse({ name: "Ali", email: "a@b.co", password: "Sifre12345x", passwordConfirm: "Sifre12345y" });
    expect(r.success).toBe(false);
  });
  it("kayıt formunda rol alanı yoktur", () => {
    const r = registerSchema.parse({ name: "Ali", email: "a@b.co", password: "Sifre12345x", passwordConfirm: "Sifre12345x", role: "ADMIN" });
    expect(r).not.toHaveProperty("role");
  });
});

describe("yardımcılar", () => {
  it("open redirect engellenir", () => {
    expect(safeRedirectPath("/account")).toBe("/account");
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("https://evil.com")).toBe("/");
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath(undefined, "/x")).toBe("/x");
  });
  it("Türkçe slug", () => {
    expect(slugify("Çok Amaçlı Şönil Eldiven 60x90")).toBe("cok-amacli-sonil-eldiven-60x90");
  });
  it("log'larda gizli alanlar maskelenir", () => {
    expect(redact({ user: "a", password: "x", nested: { apiKey: "k", ok: 1 } })).toEqual({
      user: "a", password: "[REDACTED]", nested: { apiKey: "[REDACTED]", ok: 1 },
    });
  });
});
