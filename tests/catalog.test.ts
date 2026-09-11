import { describe, expect, it } from "vitest";
import { buildQuery, parseListParams } from "@/domain/catalog/params";
import { toProductCard, toProductDetail, type ProductCardRow, type ProductDetailRow } from "@/server/catalog/dto";
import { planReturn } from "@/domain/returns/plan";
import { isValidGtin, makeEan13, normalizeGtin } from "@/domain/matching/gtin";

const SENSITIVE = /supplier|cost|tedarik/i;
const keysDeep = (v: unknown): string[] =>
  v && typeof v === "object" ? Object.entries(v).flatMap(([k, val]) => [k, ...keysDeep(val)]) : [];

describe("müşteriye açık DTO", () => {
  it("ürün kartı tedarikçi/maliyet bilgisi sızdırmaz", () => {
    // Satır yanlışlıkla fazladan alan içerse bile mapper yalnızca izinli alanları kopyalar.
    const row = {
      id: "p1", slug: "x", name: "X", minPrice: 10_000, totalAvailable: 3,
      brand: { name: "B", slug: "b" }, images: [], variants: [{ price: { compareAtAmount: 12_000 } }],
      costPrice: 1, supplierName: "MOCK A",
    } as unknown as ProductCardRow;
    const card = toProductCard(row);
    expect(keysDeep(card).filter((k) => SENSITIVE.test(k))).toEqual([]);
    expect(card).toMatchObject({ price: 10_000, compareAtPrice: 12_000, stockLevel: "LOW" });
  });

  it("ürün detayı ham stok ve tedarikçi bilgisi göstermez", () => {
    const row = {
      id: "p1", slug: "x", name: "X", shortDesc: null, description: null, specs: [{ label: "Hacim", value: "1 L" }, "bozuk"],
      seoTitle: null, seoDescription: null, brand: null, category: null, images: [],
      variants: [{ id: "v1", sku: "SS-1", name: "1 L", options: { Hacim: "1 L" }, isDefault: true,
        price: { amount: 5_000, compareAtAmount: null, costAmount: 3_000 }, inventory: { availableQty: 150, supplierQty: 160 } }],
    } as unknown as ProductDetailRow;
    const d = toProductDetail(row);
    expect(keysDeep(d).filter((k) => SENSITIVE.test(k))).toEqual([]);
    expect(d.specs).toEqual([{ label: "Hacim", value: "1 L" }]);
    expect(d.variants[0]).toMatchObject({ purchasable: true, maxQty: 20, stockLabel: "Stokta" });
    expect(JSON.stringify(d)).not.toContain("150");
  });
});

describe("liste parametreleri", () => {
  it("geçersiz değerler varsayılana döner", () => {
    const p = parseListParams({ page: "-5", sort: "hack", pageSize: "9999", brands: "ok-brand,<script>", minPrice: "abc" });
    expect(p).toMatchObject({ page: 1, sort: "relevance", pageSize: 24, brands: [], minPrice: undefined });
  });
  it("TL → kuruş ve çoklu marka", () => {
    const p = parseListParams({ minPrice: "100,5", maxPrice: "500", brands: ["slab-pro", "nordwax"], inStock: "1" });
    expect(p).toMatchObject({ minPrice: 10_050, maxPrice: 50_000, brands: ["slab-pro", "nordwax"], inStock: true });
  });
  it("query string geri üretilir", () => {
    const p = parseListParams({ q: "wax", brands: "nordwax", page: "2" });
    expect(buildQuery(p, { page: 3 })).toBe("?q=wax&brands=nordwax&page=3");
  });
});

describe("GTIN", () => {
  it("kontrol hanesi", () => {
    expect(isValidGtin("4006381333931")).toBe(true);
    expect(isValidGtin("4006381333932")).toBe(false);
    expect(isValidGtin("abc")).toBe(false);
  });
  it("UPC-A ve EAN-13 aynı 14 haneli biçime normalize olur", () => {
    expect(normalizeGtin("012345678905")).toBe(normalizeGtin("0012345678905"));
  });
  it("üretilen EAN-13 geçerli", () => {
    expect(isValidGtin(makeEan13("869999000001"))).toBe(true);
  });
});

describe("iade planı", () => {
  const items = [
    { id: "i1", quantity: 2, supplierOrderId: "soA" },
    { id: "i2", quantity: 1, supplierOrderId: "soB" },
    { id: "i3", quantity: 1, supplierOrderId: "soA" },
  ];
  it("tedarikçi siparişine göre gruplar", () => {
    const r = planReturn(items, new Map(), new Map([["i1", 1], ["i2", 1], ["i3", 1]]));
    expect(r.ok && r.groups.map((g) => [g.supplierOrderId, g.items.length])).toEqual([["soA", 2], ["soB", 1]]);
  });
  it("daha önce iade edilen adet düşülür", () => {
    expect(planReturn(items, new Map([["i1", 2]]), new Map([["i1", 1]]))).toEqual({ ok: false, error: "QTY_EXCEEDED" });
  });
  it("siparişe ait olmayan kalem reddedilir", () => {
    expect(planReturn(items, new Map(), new Map([["x", 1]]))).toEqual({ ok: false, error: "UNKNOWN_ITEM" });
  });
  it("boş talep reddedilir", () => {
    expect(planReturn(items, new Map(), new Map())).toEqual({ ok: false, error: "EMPTY" });
  });
});
