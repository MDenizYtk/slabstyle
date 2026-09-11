import { describe, expect, it } from "vitest";
import { mapRecord, parseMoney, parseStock, priceFormatSchema } from "@/server/suppliers/mapping";
import { detectDelimiter, parseCsv, parseJsonRecords, parseXmlRecords } from "@/server/suppliers/parsers";
import { normalizeRecords, parseFeedRecords } from "@/server/suppliers/adapters/feed";
import { MockSupplierAdapter } from "@/server/suppliers/adapters/mock";
import { assertSafeUrl } from "@/server/suppliers/http";
import { validateAdapterConfig } from "@/server/suppliers/registry";
import { decideRemoval, isDue, isSuspiciousPriceChange } from "@/domain/sync/guards";

const fmt = priceFormatSchema.parse({});
const trFmt = priceFormatSchema.parse({ decimalSeparator: "," });
const map = { supplierSku: "Kod", title: "Ad", costPrice: "Fiyat", stock: "Stok", gtin: "Barkod", brand: "Marka" };

describe("fiyat ve stok ayrıştırma", () => {
  it("nokta ve virgül ondalık", () => {
    expect(parseMoney("1250.90", fmt)).toBe(125_090);
    expect(parseMoney("1.250,90", trFmt)).toBe(125_090);
    expect(parseMoney("₺ 480,00", trFmt)).toBe(48_000);
  });
  it("KDV hariç fiyata KDV eklenir", () => {
    expect(parseMoney("100", priceFormatSchema.parse({ vatIncluded: false }))).toBe(12_000);
  });
  it("geçersiz fiyat null", () => {
    expect(parseMoney("", fmt)).toBeNull();
    expect(parseMoney("-5", fmt)).toBeNull();
    expect(parseMoney("abc", fmt)).toBeNull();
  });
  it("stok biçimleri", () => {
    expect(parseStock("20")).toBe(20);
    expect(parseStock("20+")).toBe(20);
    expect(parseStock("Yok")).toBe(0);
    expect(parseStock("-3")).toBe(0);
    expect(parseStock("")).toBeNull();
  });
});

describe("CSV", () => {
  it("tırnaklı alanlar, kaçış ve BOM", () => {
    const csv = '﻿Kod;Ad;Fiyat;Stok\nA1;"Şampuan; 1 L";"1.250,90";5\nA2;"Pasta ""Pro""";99,00;0\n';
    expect(detectDelimiter(csv)).toBe(";");
    const rows = parseCsv(csv, ";");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Kod: "A1", Ad: "Şampuan; 1 L", Fiyat: "1.250,90", Stok: "5" });
    expect(rows[1].Ad).toBe('Pasta "Pro"');
  });
  it("hatalı satırlar ayrılır, tekrar eden SKU raporlanır", () => {
    const csv = "Kod,Ad,Fiyat,Stok\nA1,Ürün,10,1\n,Boş SKU,10,1\nA3,Ürün 3,abc,1\nA1,Tekrar,10,1";
    const { items, errors } = normalizeRecords(parseFeedRecords(csv, { format: "csv" }), { fieldMap: map, priceFormat: fmt });
    expect(items.map((i) => i.supplierSku)).toEqual(["A1"]);
    expect(errors.map((e) => e.message)).toEqual(["SKU boş", "Geçersiz fiyat", "Tekrarlanan SKU (ilk kayıt kullanıldı)"]);
  });
});

describe("XML ve JSON", () => {
  it("XML: barkoddaki baştaki sıfır korunur, tek kayıt da dizi olur", () => {
    const xml = `<?xml version="1.0"?><Urunler><Urun><Kod>X1</Kod><Ad>Wax</Ad><Fiyat>99.90</Fiyat><Stok>3</Stok><Barkod>0012345678905</Barkod></Urun></Urunler>`;
    const records = parseXmlRecords(xml, "Urunler.Urun");
    expect(records).toHaveLength(1);
    const res = mapRecord(records[0], map, fmt, 1);
    expect(res.ok && res.product).toMatchObject({ supplierSku: "X1", gtin: "0012345678905", costPrice: 9_990, stock: 3 });
  });
  it("JSON: iç içe yol", () => {
    const records = parseJsonRecords('{"data":{"items":[{"sku":"J1","name":"N","price":{"buy":"5"},"qty":2}]}}', "data.items");
    const res = mapRecord(records[0], { supplierSku: "sku", title: "name", costPrice: "price.buy", stock: "qty" }, fmt, 1);
    expect(res.ok && res.product.costPrice).toBe(500);
  });
});

describe("MOCK adapter", () => {
  const ctx = { supplier: { id: "s1", code: "mock-a", config: { mock: true, dataset: "mock-a" } }, credentials: {}, now: 0 };
  it("deterministik katalog üretir, ağ isteği yapmaz", async () => {
    const a = new MockSupplierAdapter(ctx);
    const first: string[] = [];
    for await (const b of a.fetchProducts()) first.push(...b.items.map((i) => `${i.supplierSku}:${i.costPrice}`));
    const second: string[] = [];
    for await (const b of new MockSupplierAdapter(ctx).fetchProducts()) second.push(...b.items.map((i) => `${i.supplierSku}:${i.costPrice}`));
    expect(first.length).toBeGreaterThan(20);
    expect(first).toEqual(second);
  });
  it("aynı referansla tekrar sipariş aynı dış numarayı döner (idempotent)", async () => {
    const a = new MockSupplierAdapter(ctx);
    const payload = { reference: "cmabc123456789", orderNumber: 1, items: [], shippingAddress: { fullName: "", phone: "", line1: "", district: "", city: "", country: "TR" }, customerEmail: "" };
    expect((await a.createOrder(payload)).externalOrderId).toBe((await a.createOrder(payload)).externalOrderId);
  });
  it("hata simülasyonu", async () => {
    const a = new MockSupplierAdapter({ ...ctx, supplier: { ...ctx.supplier, config: { dataset: "mock-a", simulateFailure: "fetch" } } });
    await expect(a.testConnection()).rejects.toThrow(/simülasyon/);
  });
});

describe("adapter config doğrulama", () => {
  it("bilinmeyen adapter", () => {
    expect(validateAdapterConfig("yok", {})).toMatchObject({ ok: false });
  });
  it("feed config eksik alanları raporlar", () => {
    const r = validateAdapterConfig("generic-feed", { format: "csv" });
    expect(r.ok).toBe(false);
  });
  it("geçerli feed config", () => {
    expect(validateAdapterConfig("generic-feed", { format: "csv", productsUrl: "https://tedarikci.example/feed.csv", fieldMap: map })).toEqual({ ok: true });
  });
});

describe("SSRF koruması (üretim modu)", () => {
  it("özel ağ adresleri engellenir", () => {
    for (const url of ["http://localhost/x", "http://127.0.0.1/x", "http://10.0.0.5/x", "http://192.168.1.1/x", "http://[::1]/x", "file:///etc/passwd"]) {
      expect(() => assertSafeUrl(url, false)).toThrow();
    }
    expect(assertSafeUrl("https://tedarikci.example/feed.xml", false).host).toBe("tedarikci.example");
  });
});

describe("senkronizasyon güvenlik kuralları", () => {
  it("boş feed hiçbir ürünü kaldırmaz", () => {
    expect(decideRemoval(100, 100, 0).apply).toBe(false);
  });
  it("yüksek kaldırma oranı engellenir", () => {
    expect(decideRemoval(100, 40, 60).apply).toBe(false);
    expect(decideRemoval(100, 10, 90).apply).toBe(true);
  });
  it("şüpheli fiyat değişimi", () => {
    expect(isSuspiciousPriceChange(48_000, 480)).toBe(true);
    expect(isSuspiciousPriceChange(48_000, 50_000)).toBe(false);
    expect(isSuspiciousPriceChange(48_000, 0)).toBe(true);
  });
  it("zamanı gelen senkronizasyon", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(isDue(null, 15, now)).toBe(true);
    expect(isDue(new Date("2026-01-01T11:50:00Z"), 15, now)).toBe(false);
    expect(isDue(new Date("2026-01-01T11:45:00Z"), 15, now)).toBe(true);
  });
});
