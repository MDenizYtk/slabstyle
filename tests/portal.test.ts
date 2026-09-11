/**
 * B2B portal adapter'ı, yerelde çalışan SAHTE bir bayi paneline karşı gerçek
 * Chromium ile test edilir (ağa çıkılmaz). Chromium kurulu değilse atlanır.
 */
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { PortalSupplierAdapter, applyFieldRegex } from "@/server/suppliers/adapters/portal";
import type { NormalizedProduct } from "@/server/suppliers/types";

const PRODUCTS = [
  { sku: "K-100", name: "Seramik Sprey 500 ml", price: "1.250,90 TL", stock: "Stok: 12 adet", gtin: "8699990000017" },
  { sku: "K-101", name: "Pasta Kalın 1 L", price: "480,00 TL", stock: "Stok: 0 adet", gtin: "8699990000024" },
  { sku: "K-102", name: "Mikrofiber Set", price: "99,90 TL", stock: "Stok: 40 adet", gtin: "" },
  { sku: "K-103", name: "Jant Temizleyici", price: "fiyat sorunuz", stock: "Stok: 5 adet", gtin: "" },
];

const page = (body: string) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"></head><body>${body}</body></html>`;

function fakePortal(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const loggedIn = (req.headers.cookie ?? "").includes("sess=ok");
    const send = (status: number, html: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(html);
    };
    if (url.pathname === "/giris" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const form = new URLSearchParams(body);
        if (form.get("email") === "bayi@ornek.test" && form.get("sifre") === "DogruSifre1") {
          send(302, "", { location: "/panel", "set-cookie": "sess=ok; Path=/; HttpOnly" });
        } else send(200, page(`<p class="hata">Hatalı giriş</p><form method="post"><input name="email"><input type="password" name="sifre"><button type="submit">Giriş</button></form>`));
      });
      return;
    }
    if (url.pathname === "/giris") return send(200, page(`<form method="post"><input name="email"><input type="password" name="sifre"><button type="submit">Giriş</button></form>`));
    if (url.pathname === "/captcha-giris") return send(200, page(`<form method="post" action="/giris"><input name="email"><input type="password" name="sifre"><div class="g-recaptcha"></div><button type="submit">Giriş</button></form>`));
    if (!loggedIn) return send(302, "", { location: "/giris" });
    if (url.pathname === "/panel") return send(200, page(`<a href="/cikis">Çıkış</a>`));
    if (url.pathname === "/urunler") {
      const n = Number(url.searchParams.get("sayfa") ?? 1);
      const slice = PRODUCTS.slice((n - 1) * 2, n * 2);
      const cards = slice
        .map((p) => `<div class="urun-kart"><span class="stok-kodu">Kod: ${p.sku}</span><h3 class="urun-adi">${p.name}</h3><span class="bayi-fiyat">${p.price}</span><span class="stok">${p.stock}</span><span class="barkod">${p.gtin}</span></div>`)
        .join("");
      return send(200, page(`<a href="/cikis">Çıkış</a>${cards}`));
    }
    if (url.pathname === "/export.csv") {
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      return res.end("StokKodu;UrunAdi;Fiyat;Stok\nE-1;Cila Wax;350,50;7\nE-2;Şampuan 5 L;1.100,00;3\n");
    }
    send(404, page("yok"));
  });
}

const chromiumReady = existsSync(chromium.executablePath());
let server: Server;
let base = "";

const baseConfig = () => ({
  baseUrl: base,
  login: { url: "/giris", usernameSelector: "input[name=email]", passwordSelector: "input[name=sifre]", submitSelector: "button[type=submit]", successSelector: "a[href='/cikis']" },
  products: {
    mode: "scrape",
    listUrls: ["/urunler?sayfa={page}"],
    pagination: { type: "urlTemplate", startPage: 1, maxPages: 10 },
    itemSelector: ".urun-kart",
    fields: {
      supplierSku: { selector: ".stok-kodu", regex: "Kod:\\s*(\\S+)" },
      title: { selector: ".urun-adi" },
      costPrice: { selector: ".bayi-fiyat" },
      stock: { selector: ".stok", regex: "(\\d+)" },
      gtin: { selector: ".barkod" },
    },
  },
  throttleMs: 500,
  timeoutMs: 10_000,
});

const adapter = (config: object, credentials: Record<string, string> = { username: "bayi@ornek.test", password: "DogruSifre1" }) =>
  new PortalSupplierAdapter({ supplier: { id: "s1", code: "test-portal", config: config as never }, credentials });

async function collect(a: PortalSupplierAdapter) {
  const items: NormalizedProduct[] = [];
  const errors: { row: string | number; message: string }[] = [];
  for await (const b of a.fetchProducts()) {
    items.push(...b.items);
    errors.push(...b.errors);
  }
  return { items, errors };
}

describe("alan regex'i", () => {
  it("ilk yakalama grubunu alır, eşleşmezse boş bırakır", () => {
    expect(applyFieldRegex([{ stock: "Stok: 12 adet", sku: "x" }], { stock: { selector: "", attr: "text", regex: "(\\d+)" } })).toEqual([{ stock: "12", sku: "x" }]);
    expect(applyFieldRegex([{ stock: "Yok" }], { stock: { selector: "", attr: "text", regex: "(\\d+)" } })).toEqual([{ stock: "" }]);
  });
});

describe.skipIf(!chromiumReady)("B2B portal adapter (sahte bayi paneli, gerçek tarayıcı)", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    server = fakePortal();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("giriş yapar, sayfaları gezer, Türkçe fiyat ve stok metnini ayrıştırır", async () => {
    const { items, errors } = await collect(adapter(baseConfig()));
    expect(items.map((i) => i.supplierSku)).toEqual(["K-100", "K-101", "K-102"]);
    expect(items[0]).toMatchObject({ title: "Seramik Sprey 500 ml", costPrice: 125_090, stock: 12, gtin: "8699990000017" });
    expect(items[1]).toMatchObject({ costPrice: 48_000, stock: 0 });
    expect(errors).toEqual([{ row: "K-103", message: "Geçersiz fiyat" }]);
  });

  it("bağlantı testi yalnızca ilk sayfayı okur ve örnek döner", async () => {
    const res = await adapter(baseConfig()).testConnection();
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Giriş başarılı\. İlk sayfada 2 ürün/);
    expect(res.sample?.[0]).toMatchObject({ supplierSku: "K-100" });
  });

  it("yanlış şifrede açık hata verir", async () => {
    const res = await adapter(baseConfig(), { username: "bayi@ornek.test", password: "yanlis" }).testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Giriş başarısız/);
  });

  it("kimlik bilgisi yoksa tarayıcı açmadan önce uyarır", async () => {
    const res = await adapter(baseConfig(), {}).testConnection();
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/kayıtlı değil/) });
  });

  it("CAPTCHA görürse aşmaya çalışmaz, durur", async () => {
    const cfg = baseConfig();
    const res = await adapter({ ...cfg, login: { ...cfg.login, url: "/captcha-giris" } }).testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/CAPTCHA/);
  });

  it("dışa aktarım dosyası (CSV) modunda giriş çerezleriyle indirir", async () => {
    const cfg = {
      ...baseConfig(),
      products: { mode: "download", exportUrl: "/export.csv", format: "csv", fieldMap: { supplierSku: "StokKodu", title: "UrunAdi", costPrice: "Fiyat", stock: "Stok" } },
    };
    const { items } = await collect(adapter(cfg));
    expect(items.map((i) => [i.supplierSku, i.costPrice, i.stock])).toEqual([["E-1", 35_050, 7], ["E-2", 110_000, 3]]);
  });

  it("stok/fiyat senkronizasyonu için hafif güncelleme üretir", async () => {
    const updates = [];
    for await (const b of adapter(baseConfig()).fetchStockAndPrices()) updates.push(...b.items);
    expect(updates[0]).toEqual({ supplierSku: "K-100", stock: 12, costPrice: 125_090, isActive: undefined });
  });
});
