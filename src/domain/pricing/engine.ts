/**
 * Fiyat hesaplama motoru. Saf fonksiyonlardan oluşur: veritabanına ya da
 * framework'e bağımlı değildir, bu yüzden hem sync işlerinde hem admin
 * önizlemesinde hem de testlerde aynen kullanılır.
 *
 * Tüm tutarlar kuruş cinsinden tam sayıdır. Marj baz puandır (2500 = %25).
 */

export type PricingScope = "GLOBAL" | "SUPPLIER" | "CATEGORY" | "BRAND";
export type Rounding = "NONE" | "WHOLE" | "END_90" | "END_99";

export type PricingRuleInput = {
  id: string;
  scope: PricingScope;
  supplierId?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  minCost?: number | null;
  maxCost?: number | null;
  marginBps: number;
  fixedMarkup?: number;
  priority?: number;
  rounding?: Rounding;
  isActive?: boolean;
};

export type PricingSettings = {
  /** Hiçbir kural uymazsa kullanılacak marj. */
  defaultMarginBps: number;
  defaultRounding: Rounding;
  /** Kural ne derse desin bu marjın altına inilmez. */
  minMarginBps: number;
  /** Ürün başına minimum kâr (kuruş). */
  minProfit: number;
};

export type PricingContext = {
  cost: number;
  supplierId: string;
  categoryId?: string | null;
  brandId?: string | null;
};

export type PriceResult = {
  amount: number;
  cost: number;
  profit: number;
  /** Gerçekleşen marj (bps), maliyete göre. */
  effectiveMarginBps: number;
  ruleId: string | null;
  floorApplied: "NONE" | "MIN_MARGIN" | "MIN_PROFIT";
};

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  defaultMarginBps: 2500,
  defaultRounding: "END_90",
  minMarginBps: 1000,
  minProfit: 2000,
};

const SPECIFICITY: Record<PricingScope, number> = { SUPPLIER: 3, CATEGORY: 2, BRAND: 1, GLOBAL: 0 };

function ruleMatches(rule: PricingRuleInput, ctx: PricingContext): boolean {
  if (rule.isActive === false) return false;
  if (rule.minCost != null && ctx.cost < rule.minCost) return false;
  if (rule.maxCost != null && ctx.cost >= rule.maxCost) return false;
  switch (rule.scope) {
    case "GLOBAL":
      return true;
    case "SUPPLIER":
      return rule.supplierId != null && rule.supplierId === ctx.supplierId;
    case "CATEGORY":
      return rule.categoryId != null && rule.categoryId === ctx.categoryId;
    case "BRAND":
      return rule.brandId != null && rule.brandId === ctx.brandId;
  }
}

/**
 * Uygun kurallar arasından seçim sırası:
 * 1) yüksek priority, 2) daha özel kapsam (tedarikçi > kategori > marka > genel),
 * 3) daha dar maliyet aralığı, 4) id (deterministik sonuç için).
 */
export function selectRule(rules: readonly PricingRuleInput[], ctx: PricingContext): PricingRuleInput | null {
  const width = (r: PricingRuleInput) => (r.maxCost ?? Number.MAX_SAFE_INTEGER) - (r.minCost ?? 0);
  const candidates = rules.filter((r) => ruleMatches(r, ctx));
  candidates.sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      SPECIFICITY[b.scope] - SPECIFICITY[a.scope] ||
      width(a) - width(b) ||
      a.id.localeCompare(b.id),
  );
  return candidates[0] ?? null;
}

/** Yuvarlama asla fiyatı düşürmez; yalnızca yukarı yuvarlar. */
export function roundPrice(amount: number, rounding: Rounding): number {
  switch (rounding) {
    case "NONE":
      return amount;
    case "WHOLE":
      return Math.ceil(amount / 100) * 100;
    case "END_90":
    case "END_99": {
      const ending = rounding === "END_90" ? 90 : 99;
      let candidate = Math.floor(amount / 100) * 100 + ending;
      if (candidate < amount) candidate += 100;
      return candidate;
    }
  }
}

const markup = (cost: number, bps: number) => Math.ceil((cost * bps) / 10_000);

export function calculatePrice(
  ctx: PricingContext,
  rules: readonly PricingRuleInput[],
  settings: PricingSettings = DEFAULT_PRICING_SETTINGS,
): PriceResult {
  if (!Number.isInteger(ctx.cost) || ctx.cost < 0) {
    throw new RangeError(`Geçersiz maliyet: ${ctx.cost}`);
  }

  const rule = selectRule(rules, ctx);
  const marginBps = rule?.marginBps ?? settings.defaultMarginBps;
  const rounding = rule?.rounding ?? settings.defaultRounding;

  const ruleAmount = ctx.cost + markup(ctx.cost, marginBps) + (rule?.fixedMarkup ?? 0);
  const minMarginAmount = ctx.cost + markup(ctx.cost, settings.minMarginBps);
  const minProfitAmount = ctx.cost + settings.minProfit;

  let amount = ruleAmount;
  let floorApplied: PriceResult["floorApplied"] = "NONE";
  if (minMarginAmount > amount) {
    amount = minMarginAmount;
    floorApplied = "MIN_MARGIN";
  }
  if (minProfitAmount > amount) {
    amount = minProfitAmount;
    floorApplied = "MIN_PROFIT";
  }

  amount = roundPrice(amount, rounding);
  const profit = amount - ctx.cost;

  return {
    amount,
    cost: ctx.cost,
    profit,
    effectiveMarginBps: ctx.cost === 0 ? 0 : Math.floor((profit * 10_000) / ctx.cost),
    ruleId: rule?.id ?? null,
    floorApplied,
  };
}
