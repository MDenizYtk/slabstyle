import { describe, expect, it } from "vitest";
import { decideMatch, normalizeBrand, type MatchSignals } from "@/domain/matching/decide";

const none: MatchSignals = { gtinMatches: [], mpnMatches: [], skuMatches: [], fuzzy: [] };

describe("ürün eşleştirme kararı", () => {
  it("1) tek GTIN eşleşmesi otomatik birleştirilir", () => {
    expect(decideMatch({ ...none, gtinMatches: ["v1"] })).toEqual({ kind: "AUTO", variantId: "v1", method: "GTIN", confidence: 1 });
  });
  it("GTIN diğer sinyallerden önce gelir", () => {
    const d = decideMatch({ ...none, gtinMatches: ["v1"], mpnMatches: [{ variantId: "v2", brandMatches: true, gtinConflict: false }] });
    expect(d).toMatchObject({ kind: "AUTO", variantId: "v1" });
  });
  it("aynı barkod birden fazla varyantta → admin onayı", () => {
    expect(decideMatch({ ...none, gtinMatches: ["v1", "v2"] }).kind).toBe("REVIEW");
  });
  it("2) MPN + marka tek eşleşme → otomatik", () => {
    expect(decideMatch({ ...none, mpnMatches: [{ variantId: "v1", brandMatches: true, gtinConflict: false }] })).toMatchObject({ kind: "AUTO", method: "MPN" });
  });
  it("MPN var ama marka tutmuyor → otomatik birleştirme YOK", () => {
    const d = decideMatch({ ...none, mpnMatches: [{ variantId: "v1", brandMatches: false, gtinConflict: false }] });
    expect(d.kind).toBe("REVIEW");
  });
  it("MPN tutuyor ama barkod çelişiyor → admin onayı", () => {
    expect(decideMatch({ ...none, mpnMatches: [{ variantId: "v1", brandMatches: true, gtinConflict: true }] }).kind).toBe("REVIEW");
  });
  it("aynı MPN birden fazla varyantta → admin onayı", () => {
    const d = decideMatch({
      ...none,
      mpnMatches: [
        { variantId: "v1", brandMatches: true, gtinConflict: false },
        { variantId: "v2", brandMatches: false, gtinConflict: false },
      ],
    });
    expect(d.kind).toBe("REVIEW");
  });
  it("3) SKU eşleşmesi asla otomatik değildir", () => {
    expect(decideMatch({ ...none, skuMatches: ["v1"] })).toMatchObject({ kind: "REVIEW", candidates: [{ method: "SUPPLIER_SKU" }] });
  });
  it("4) isim benzerliği eşik üstünde öneri olur, altında yok sayılır", () => {
    const d = decideMatch({ ...none, fuzzy: [{ variantId: "v1", score: 0.9 }, { variantId: "v2", score: 0.2 }] });
    expect(d.kind === "REVIEW" && d.candidates.map((c) => c.variantId)).toEqual(["v1"]);
    expect(d.kind === "REVIEW" && d.candidates[0].score).toBeLessThan(0.8);
  });
  it("hiç sinyal yoksa eşleşmez", () => {
    expect(decideMatch(none)).toEqual({ kind: "NONE" });
  });
  it("aynı varyant için en güçlü sinyal tutulur", () => {
    const d = decideMatch({ ...none, skuMatches: ["v1"], fuzzy: [{ variantId: "v1", score: 0.7 }] });
    expect(d.kind === "REVIEW" && d.candidates).toEqual([{ variantId: "v1", method: "BRAND_MODEL", score: 0.7 }]);
  });
  it("marka normalizasyonu", () => {
    expect(normalizeBrand("Aqua Shield")).toBe(normalizeBrand("AquaShield"));
    expect(normalizeBrand("Işık Kimya")).toBe("isikkimya");
  });
});
