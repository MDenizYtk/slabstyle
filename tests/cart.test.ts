import { describe, expect, it } from "vitest";
import { computeCartTotals, evaluateLine, includedTax, MAX_QTY_PER_LINE, type CartLineInput } from "@/domain/cart/totals";
import { shippingFee } from "@/domain/shipping/methods";

const line = (over: Partial<CartLineInput> = {}): CartLineInput => ({
  itemId: "i1", variantId: "v1", quantity: 2, unitPrice: 25_000, availableQty: 10, isPurchasable: true, ...over,
});

describe("sepet satırı", () => {
  it("geçerli satır", () => {
    expect(evaluateLine(line())).toMatchObject({ lineTotal: 50_000, issue: null, maxQty: 10 });
  });
  it("stok yetersiz", () => {
    expect(evaluateLine(line({ quantity: 12 })).issue).toBe("INSUFFICIENT_STOCK");
  });
  it("stok yok", () => {
    expect(evaluateLine(line({ availableQty: 0 })).issue).toBe("OUT_OF_STOCK");
  });
  it("satıştan kalkmış ürün", () => {
    expect(evaluateLine(line({ isPurchasable: false })).issue).toBe("UNAVAILABLE");
  });
  it("fiyatı olmayan ürün satılamaz", () => {
    expect(evaluateLine(line({ unitPrice: null })).issue).toBe("NO_PRICE");
  });
  it("satır başı azami adet", () => {
    expect(evaluateLine(line({ availableQty: 500 })).maxQty).toBe(MAX_QTY_PER_LINE);
  });
});

describe("sepet toplamı", () => {
  it("sorunlu satırlar toplama katılmaz", () => {
    const t = computeCartTotals([line(), line({ itemId: "i2", variantId: "v2", availableQty: 0 })]);
    expect(t.subtotal).toBe(50_000);
    expect(t.itemCount).toBe(2);
    expect(t.hasIssues).toBe(true);
  });
  it("ücretsiz kargo eşiği", () => {
    const t = computeCartTotals([line({ quantity: 3 })]);
    expect(t.subtotal).toBe(75_000);
    expect(t.shippingTotal).toBe(0);
    expect(t.grandTotal).toBe(75_000);
  });
  it("eşik altında kargo ücreti eklenir", () => {
    const t = computeCartTotals([line({ quantity: 1 })]);
    expect(t.shippingTotal).toBe(7_990);
    expect(t.grandTotal).toBe(32_990);
  });
  it("hızlı kargoda eşik uygulanmaz", () => {
    expect(shippingFee(200_000, "express")).toBe(14_990);
  });
  it("boş sepette kargo yok", () => {
    expect(computeCartTotals([]).grandTotal).toBe(0);
  });
  it("KDV dahil fiyattan KDV payı", () => {
    expect(includedTax(12_000)).toBe(2_000);
  });
});
