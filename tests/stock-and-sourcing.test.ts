import { describe, expect, it } from "vitest";
import { aggregateStock, sellableQty, stockLabel, stockLevel } from "@/domain/inventory/stock";
import { rankOffers, selectBestOffer, type SupplierOffer } from "@/domain/sourcing/select-offer";

describe("safety stock", () => {
  it("tedarikçi stoğundan tampon düşülür", () => {
    expect(sellableQty(20, 2)).toBe(18);
  });
  it("negatif olmaz", () => {
    expect(sellableQty(1, 5)).toBe(0);
    expect(sellableQty(-3, 0)).toBe(0);
    expect(sellableQty(Number.NaN, 0)).toBe(0);
  });
  it("toplam stok yalnızca aktif teklifleri sayar", () => {
    expect(
      aggregateStock([
        { stock: 20, safetyStock: 2, isAvailable: true },
        { stock: 5, safetyStock: 1, isAvailable: true },
        { stock: 100, safetyStock: 0, isAvailable: false },
        { stock: 0, safetyStock: 0, isAvailable: true },
      ]),
    ).toEqual({ availableQty: 22, supplierQty: 25 });
  });
  it("stok 0 olunca satışa kapalı etiketi", () => {
    expect(stockLevel(0)).toBe("OUT_OF_STOCK");
    expect(stockLabel(0)).toBe("Tükendi");
    expect(stockLabel(3)).toBe("Son 3 ürün");
    expect(stockLabel(50)).toBe("Stokta");
  });
});

// Kullanıcının örneği: A 500 TL/20, B 480 TL/5, C 550 TL/0
const offers: SupplierOffer[] = [
  { supplierProductId: "a", supplierId: "A", cost: 50_000, stock: 20, safetyStock: 2, leadTimeDays: 2, supplierPriority: 10, isAvailable: true },
  { supplierProductId: "b", supplierId: "B", cost: 48_000, stock: 5, safetyStock: 1, leadTimeDays: 1, supplierPriority: 5, isAvailable: true },
  { supplierProductId: "c", supplierId: "C", cost: 55_000, stock: 0, safetyStock: 0, leadTimeDays: 4, supplierPriority: 0, isAvailable: true },
];

describe("tedarikçi seçimi", () => {
  it("varsayılan: en düşük maliyetli ve stoğu olan", () => {
    expect(selectBestOffer(offers)?.supplierId).toBe("B");
  });
  it("adet ucuz tedarikçinin stoğunu aşarsa sonrakine geçer", () => {
    expect(selectBestOffer(offers, { quantity: 5 })?.supplierId).toBe("A");
  });
  it("hiçbiri karşılayamazsa null", () => {
    expect(selectBestOffer(offers, { quantity: 50 })).toBeNull();
  });
  it("stoksuz tedarikçi seçilmez", () => {
    expect(selectBestOffer([offers[2]])).toBeNull();
  });
  it("pasif tedarikçi seçilmez", () => {
    expect(selectBestOffer(offers.map((o) => (o.supplierId === "B" ? { ...o, isAvailable: false } : o)))?.supplierId).toBe("A");
  });
  it("FASTEST ve PRIORITY stratejileri", () => {
    expect(selectBestOffer(offers, { strategy: "FASTEST" })?.supplierId).toBe("B");
    expect(selectBestOffer(offers, { strategy: "PRIORITY" })?.supplierId).toBe("A");
  });
  it("eşit maliyette öncelik belirleyici", () => {
    const tie = [offers[0], { ...offers[1], cost: 50_000 }];
    expect(rankOffers(tie)[0].supplierId).toBe("A");
  });
});
