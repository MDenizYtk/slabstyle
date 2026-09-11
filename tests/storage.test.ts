import { describe, expect, it } from "vitest";
import { detectImage } from "@/server/storage";

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
