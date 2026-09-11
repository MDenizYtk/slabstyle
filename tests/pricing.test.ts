import { describe, expect, it } from "vitest";
import { calculatePrice, roundPrice, selectRule, type PricingRuleInput, type PricingSettings } from "@/domain/pricing/engine";

const tiers: PricingRuleInput[] = [
  { id: "t1", scope: "GLOBAL", maxCost: 50_000, marginBps: 3000, rounding: "NONE" },
  { id: "t2", scope: "GLOBAL", minCost: 50_000, maxCost: 150_000, marginBps: 2500, rounding: "NONE" },
  { id: "t3", scope: "GLOBAL", minCost: 150_000, marginBps: 2000, rounding: "NONE" },
];
const settings: PricingSettings = { defaultMarginBps: 2500, defaultRounding: "NONE", minMarginBps: 1000, minProfit: 0 };
const ctx = (cost: number, extra: Partial<{ supplierId: string; categoryId: string; brandId: string }> = {}) => ({ cost, supplierId: "sA", ...extra });

describe("fiyat motoru — kademeli marj", () => {
  it("500 TL altı %30", () => {
    expect(calculatePrice(ctx(40_000), tiers, settings)).toMatchObject({ amount: 52_000, ruleId: "t1", profit: 12_000 });
  });
  it("500–1500 TL arası %25 (alt sınır dahil)", () => {
    expect(calculatePrice(ctx(50_000), tiers, settings)).toMatchObject({ amount: 62_500, ruleId: "t2" });
  });
  it("1500 TL ve üzeri %20 (üst sınır hariç, bir sonraki kademeye geçer)", () => {
    expect(calculatePrice(ctx(150_000), tiers, settings)).toMatchObject({ amount: 180_000, ruleId: "t3" });
  });
  it("kural yoksa varsayılan marj", () => {
    expect(calculatePrice(ctx(10_000), [], settings)).toMatchObject({ amount: 12_500, ruleId: null });
  });
  it("tam sayı dışı veya negatif maliyet reddedilir", () => {
    expect(() => calculatePrice(ctx(-1), tiers, settings)).toThrow(RangeError);
    expect(() => calculatePrice(ctx(10.5), tiers, settings)).toThrow(RangeError);
  });
});

describe("fiyat motoru — tabanlar", () => {
  it("minimum marj kuralın altına inilmesini engeller", () => {
    const low: PricingRuleInput[] = [{ id: "low", scope: "GLOBAL", marginBps: 300, rounding: "NONE" }];
    const r = calculatePrice(ctx(100_000), low, settings);
    expect(r.amount).toBe(110_000);
    expect(r.floorApplied).toBe("MIN_MARGIN");
  });
  it("minimum kâr ucuz ürünlerde uygulanır", () => {
    const r = calculatePrice(ctx(1_000), tiers, { ...settings, minProfit: 2_000 });
    expect(r.amount).toBe(3_000);
    expect(r.floorApplied).toBe("MIN_PROFIT");
  });
  it("sabit ek ücret eklenir", () => {
    const rules: PricingRuleInput[] = [{ id: "f", scope: "GLOBAL", marginBps: 1000, fixedMarkup: 500, rounding: "NONE" }];
    expect(calculatePrice(ctx(10_000), rules, settings).amount).toBe(11_500);
  });
});

describe("kural seçimi", () => {
  const rules: PricingRuleInput[] = [
    ...tiers,
    { id: "sup", scope: "SUPPLIER", supplierId: "sB", marginBps: 1800, rounding: "NONE" },
    { id: "cat", scope: "CATEGORY", categoryId: "c1", marginBps: 3500, rounding: "NONE" },
    { id: "off", scope: "GLOBAL", marginBps: 9000, priority: 99, isActive: false },
  ];
  it("tedarikçi kuralı genel kademeden daha özeldir", () => {
    expect(selectRule(rules, ctx(40_000, { supplierId: "sB" }))?.id).toBe("sup");
  });
  it("tedarikçi > kategori", () => {
    expect(selectRule(rules, ctx(40_000, { supplierId: "sB", categoryId: "c1" }))?.id).toBe("sup");
  });
  it("kategori kuralı başka tedarikçide uygulanır", () => {
    expect(selectRule(rules, ctx(40_000, { categoryId: "c1" }))?.id).toBe("cat");
  });
  it("pasif kural yok sayılır", () => {
    expect(selectRule(rules, ctx(40_000))?.id).toBe("t1");
  });
  it("yüksek priority her şeyi ezer", () => {
    const withPriority = [...rules, { id: "prio", scope: "GLOBAL" as const, marginBps: 4000, priority: 5 }];
    expect(selectRule(withPriority, ctx(40_000, { supplierId: "sB" }))?.id).toBe("prio");
  });
});

describe("yuvarlama", () => {
  it("asla fiyatı düşürmez", () => {
    expect(roundPrice(52_000, "END_90")).toBe(52_090);
    expect(roundPrice(52_095, "END_90")).toBe(52_190);
    expect(roundPrice(52_090, "END_90")).toBe(52_090);
    expect(roundPrice(52_001, "WHOLE")).toBe(52_100);
    expect(roundPrice(52_000, "END_99")).toBe(52_099);
    expect(roundPrice(52_001, "NONE")).toBe(52_001);
  });
  it("yuvarlama sonrası kâr korunur", () => {
    const r = calculatePrice(ctx(40_000), [{ ...tiers[0], rounding: "END_90" }], settings);
    expect(r.amount).toBe(52_090);
    expect(r.profit).toBe(12_090);
  });
});
