import { describe, expect, it } from "vitest";
import { groupKeyFromFilename, groupNameFromFilename, productNameFromFilename } from "@/domain/catalog/filename";

describe("dosya adından ürün adı", () => {
  it("tire ve alt çizgi boşluğa çevrilir, kelimeler büyük harfle başlar", () => {
    expect(productNameFromFilename("bmw-f30-sag-far.jpg")).toBe("Bmw F30 Sag Far");
    expect(productNameFromFilename("audi_a4_stop_lambasi.png")).toBe("Audi A4 Stop Lambasi");
  });
  it("baştaki sıra numarası atılır", () => {
    expect(productNameFromFilename("01_golf_7_far.jpg")).toBe("Golf 7 Far");
    expect(productNameFromFilename("12 - mercedes w205 far.webp")).toBe("Mercedes W205 Far");
  });
  it("Türkçe harfler doğru büyür", () => {
    expect(productNameFromFilename("ışıklı-çıta-şerit.jpg")).toBe("Işıklı Çıta Şerit");
    expect(productNameFromFilename("iç-aydınlatma.jpg")).toBe("İç Aydınlatma");
  });
  it("uzantısı olmayan ve boş adlar", () => {
    expect(productNameFromFilename("far")).toBe("Far");
    expect(productNameFromFilename("___.jpg")).toBe("Ürün");
  });
  it("sondaki sayı ürün adının parçasıysa korunur", () => {
    expect(productNameFromFilename("golf-7-far-2.jpg")).toBe("Golf 7 Far 2");
  });
});

describe("aynı ürünün fotoğraflarını gruplama", () => {
  it("sondaki sayaç atılır", () => {
    expect(groupNameFromFilename("far-2.jpg")).toBe("Far");
    expect(groupNameFromFilename("far (3).jpg")).toBe("Far");
    expect(groupNameFromFilename("far_02.png")).toBe("Far");
  });
  it("aynı ürünün farklı fotoğrafları aynı anahtarı üretir", () => {
    const keys = ["bmw-f30-far.jpg", "bmw-f30-far-2.jpg", "BMW_F30_FAR (3).JPG"].map(groupKeyFromFilename);
    expect(new Set(keys).size).toBe(1);
  });
  it("farklı ürünler ayrı kalır", () => {
    expect(groupKeyFromFilename("bmw-far.jpg")).not.toBe(groupKeyFromFilename("audi-far.jpg"));
  });
});
