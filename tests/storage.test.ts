import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { detectImage, MAX_EDGE, optimizeImage } from "@/server/storage";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("fotoğraf türü tespiti (sihirli baytlar)", () => {
  it("JPG, PNG, WEBP, AVIF tanınır", () => {
    expect(detectImage(bytes([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(detectImage(bytes([0x89], "PNG", [0x0d, 0x0a]))?.ext).toBe("png");
    expect(detectImage(bytes("RIFF", [0, 0, 0, 0], "WEBP"))?.ext).toBe("webp");
    expect(detectImage(bytes([0, 0, 0, 0x1c], "ftypavif"))?.ext).toBe("avif");
  });
  it("uzantısı resim olan HTML/SVG/EXE reddedilir", () => {
    expect(detectImage(bytes("<html><script>"))).toBeNull();
    expect(detectImage(bytes("<svg xmlns="))).toBeNull();
    expect(detectImage(bytes("MZ", [0x90, 0]))).toBeNull();
  });
});

describe("fotoğraf küçültme", () => {
  // Telefon fotoğrafı benzeri büyük bir JPEG üret (4000x3000).
  const bigJpeg = () =>
    sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 80, b: 20 } } })
      .jpeg({ quality: 95 })
      .toBuffer();

  it("uzun kenarı sınırlar, WebP'ye çevirir ve boyutu küçültür", async () => {
    const input = await bigJpeg();
    const out = await optimizeImage(new Uint8Array(input));
    expect(out.width).toBe(MAX_EDGE);
    expect(out.height).toBe(Math.round((MAX_EDGE * 3) / 4));
    expect(detectImage(new Uint8Array(out.data))?.ext).toBe("webp");
    expect(out.data.byteLength).toBeLessThan(input.byteLength / 2);
  });

  it("küçük fotoğrafı büyütmez", async () => {
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#222" } }).png().toBuffer();
    const out = await optimizeImage(new Uint8Array(small));
    expect([out.width, out.height]).toEqual([300, 200]);
  });

  it("bozuk dosya hata verir", async () => {
    await expect(optimizeImage(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});
