/**
 * B2B BAYİ PANELİ ADAPTER'I (API'si olmayan tedarikçiler)
 *
 * Tedarikçinin bayi paneline, admin panelinden girilen bayi kullanıcı adı/şifresi
 * ile görünmez bir tarayıcı (Playwright/Chromium) üzerinden giriş yapar ve:
 *   - mode "scrape":   ürün listesi sayfalarını gezip seçicilerle alanları okur
 *   - mode "download": paneldeki Excel/CSV/XML dışa aktarımını indirip okur
 *
 * Her şey config ile tanımlanır; site değişirse yalnızca seçiciler güncellenir.
 *
 * Kurallar:
 *  - CAPTCHA/robot doğrulaması ASLA aşılmaya çalışılmaz; tespit edilirse iş durur.
 *  - Sayfalar arasında bekleme (throttleMs) ve sayfa sınırı (maxPages) vardır.
 *  - Şifreler yalnızca bellekte, giriş formuna yazılırken kullanılır; log'lanmaz.
 *  - Siparişler bu adapter ile otomatik girilmez (admin panelde manuel akış).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BrowserContext, Page } from "playwright";
import { logger } from "../../logger";
import { randomToken } from "../../security/crypto";
import { parseXlsx } from "../excel";
import { assertSafeUrl } from "../http";
import { fieldMapSchema, priceFormatSchema, toStockUpdate } from "../mapping";
import { parseFeedRecords, normalizeRecords } from "./feed";
import type { AdapterContext } from "../registry";
import {
  AdapterConfigError,
  AdapterNotSupportedError,
  type ConnectionTestResult,
  type ProductBatch,
  type RowError,
  type StockBatch,
  type SupplierAdapter,
} from "../types";

const fieldSchema = z.object({
  /** Ürün kutusunun içindeki seçici; boşsa kutunun kendisi. */
  selector: z.string().default(""),
  /** "text" (görünen metin) ya da bir HTML özelliği: "href", "src", "data-sku"… */
  attr: z.string().default("text"),
  /** İsteğe bağlı: değerden ilk yakalama grubunu al. Ör. "Stok: (\\d+)" */
  regex: z.string().optional(),
});

const stepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), url: z.string() }),
  z.object({ action: z.literal("fill"), selector: z.string(), value: z.string() }),
  z.object({ action: z.literal("click"), selector: z.string() }),
  z.object({ action: z.literal("select"), selector: z.string(), value: z.string() }),
  z.object({ action: z.literal("waitFor"), selector: z.string() }),
  z.object({ action: z.literal("wait"), ms: z.number().int().min(0).max(30_000) }),
]);

const scrapeSchema = z.object({
  mode: z.literal("scrape"),
  /** Liste sayfaları. urlTemplate sayfalamada {page} yer tutucusu kullanılır. */
  listUrls: z.array(z.string()).min(1),
  pagination: z
    .object({
      type: z.enum(["none", "urlTemplate", "nextButton"]).default("none"),
      startPage: z.number().int().min(0).default(1),
      maxPages: z.number().int().min(1).max(1000).default(50),
      nextSelector: z.string().optional(),
    })
    .default({ type: "none", startPage: 1, maxPages: 50 }),
  itemSelector: z.string().min(1),
  fields: z.object({
    supplierSku: fieldSchema,
    title: fieldSchema,
    costPrice: fieldSchema,
    stock: fieldSchema,
    gtin: fieldSchema.optional(),
    mpn: fieldSchema.optional(),
    brand: fieldSchema.optional(),
    images: fieldSchema.optional(),
    categoryPath: fieldSchema.optional(),
    description: fieldSchema.optional(),
  }),
});

const downloadSchema = z.object({
  mode: z.literal("download"),
  /** Doğrudan dosya adresi (giriş çerezleriyle indirilir)… */
  exportUrl: z.string().optional(),
  /** …ya da dışa aktarım sayfası + indirme butonu. */
  exportPageUrl: z.string().optional(),
  exportClickSelector: z.string().optional(),
  format: z.enum(["csv", "xlsx", "xml", "json"]),
  /** Türk tedarikçilerde CSV sıklıkla windows-1254 kodlamalıdır. */
  encoding: z.string().default("utf-8"),
  itemPath: z.string().optional(),
  csvDelimiter: z.string().max(1).optional(),
  fieldMap: fieldMapSchema,
});

export const portalConfigSchema = z.object({
  baseUrl: z.url(),
  login: z.object({
    url: z.string(),
    usernameSelector: z.string().min(1),
    passwordSelector: z.string().min(1),
    submitSelector: z.string().min(1),
    /** Başarılı girişten sonra görünen bir öğe (ör. "Çıkış" linki). */
    successSelector: z.string().min(1),
    beforeSteps: z.array(stepSchema).default([]),
    afterSteps: z.array(stepSchema).default([]),
  }),
  products: z.discriminatedUnion("mode", [scrapeSchema, downloadSchema]),
  priceFormat: priceFormatSchema.default({ decimalSeparator: ",", vatIncluded: true, vatRateBps: 2000, inMinorUnits: false, currency: "TRY" }),
  throttleMs: z.number().int().min(500).max(30_000).default(1500),
  timeoutMs: z.number().int().min(5_000).max(120_000).default(30_000),
  userAgent: z.string().optional(),
  /** Yavaşlatmamak için resim/font indirilmez. */
  blockAssets: z.boolean().default(true),
});

export type PortalConfig = z.infer<typeof portalConfigSchema>;
type ScrapeConfig = z.infer<typeof scrapeSchema>;
type FieldSpec = z.infer<typeof fieldSchema>;

const CAPTCHA_SELECTOR = [
  ".g-recaptcha",
  ".h-captcha",
  ".cf-turnstile",
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="turnstile"]',
  'iframe[src*="captcha"]',
].join(", ");

const DEBUG_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "debug");
const BATCH = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PortalLoginError extends Error {}
export class CaptchaDetectedError extends Error {}

/** Tarayıcıdan gelen ham değerlere regex uygular (Node tarafında). */
export function applyFieldRegex(records: Record<string, string>[], fields: Record<string, FieldSpec | undefined>) {
  const compiled = Object.entries(fields).flatMap(([name, spec]) => (spec?.regex ? [[name, new RegExp(spec.regex, "i")] as const] : []));
  return records.map((r) => {
    const out = { ...r };
    for (const [name, re] of compiled) {
      const m = re.exec(out[name] ?? "");
      out[name] = m ? (m[1] ?? m[0]).trim() : "";
    }
    return out;
  });
}

export class PortalSupplierAdapter implements SupplierAdapter {
  readonly key = "b2b-portal";
  readonly capabilities = { products: true, stockPrice: true, orders: false, orderStatus: false, tracking: false, webhooks: false };
  private readonly cfg: PortalConfig;

  constructor(private readonly ctx: AdapterContext) {
    this.cfg = portalConfigSchema.parse(ctx.supplier.config);
    const p = this.cfg.products;
    if (p.mode === "download" && !p.exportUrl && !(p.exportPageUrl && p.exportClickSelector)) {
      throw new AdapterConfigError("download modu için exportUrl ya da exportPageUrl + exportClickSelector gerekli");
    }
    if (p.mode === "scrape" && p.pagination.type === "nextButton" && !p.pagination.nextSelector) {
      throw new AdapterConfigError("nextButton sayfalaması için nextSelector gerekli");
    }
  }

  private url(u: string): string {
    const full = new URL(u, this.cfg.baseUrl).toString();
    assertSafeUrl(full);
    return full;
  }

  private template(value: string): string {
    return value.replace(/\{\{(\w+)\}\}/g, (_, k: string) => this.ctx.credentials[k] ?? "");
  }

  private async runSteps(page: Page, steps: PortalConfig["login"]["beforeSteps"]) {
    for (const s of steps) {
      if (s.action === "goto") await page.goto(this.url(s.url));
      else if (s.action === "fill") await page.fill(s.selector, this.template(s.value));
      else if (s.action === "click") await page.click(s.selector);
      else if (s.action === "select") await page.selectOption(s.selector, this.template(s.value));
      else if (s.action === "waitFor") await page.waitForSelector(s.selector);
      else await sleep(s.ms);
    }
  }

  private async hasCaptcha(page: Page): Promise<boolean> {
    return (await page.locator(CAPTCHA_SELECTOR).count()) > 0;
  }

  private async login(page: Page) {
    const { username, password } = this.ctx.credentials;
    if (!username || !password) throw new PortalLoginError("Bayi paneli kullanıcı adı/şifresi kayıtlı değil (Kimlik bilgileri bölümü)");
    const l = this.cfg.login;
    await page.goto(this.url(l.url));
    await this.runSteps(page, l.beforeSteps);
    if (await this.hasCaptcha(page)) {
      throw new CaptchaDetectedError("Giriş sayfasında CAPTCHA/robot doğrulaması var; otomatik giriş yapılmaz. Tedarikçiden dışa aktarım dosyası veya API isteyin.");
    }
    await page.fill(l.usernameSelector, username);
    await page.fill(l.passwordSelector, password);
    await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => undefined), page.click(l.submitSelector)]);
    try {
      await page.waitForSelector(l.successSelector, { timeout: Math.min(this.cfg.timeoutMs, 20_000) });
    } catch {
      if (await this.hasCaptcha(page)) throw new CaptchaDetectedError("Girişten sonra CAPTCHA istendi; otomatik devam edilmez.");
      throw new PortalLoginError("Giriş başarısız: kullanıcı adı/şifre hatalı ya da successSelector sayfada bulunamadı");
    }
    await this.runSteps(page, l.afterSteps);
  }

  /** Hata anının ekran görüntüsü (yalnızca admin görebilir). */
  private async debugShot(page: Page | undefined): Promise<string | null> {
    if (!page) return null;
    try {
      const dir = path.join(/* turbopackIgnore: true */ DEBUG_ROOT, this.ctx.supplier.code.replace(/[^a-z0-9-]/g, ""));
      await mkdir(dir, { recursive: true });
      const file = `${Date.now()}-${randomToken(6)}.png`;
      await writeFile(path.join(/* turbopackIgnore: true */ dir, file), await page.screenshot({ fullPage: true }));
      return `/admin/portal-debug/${path.basename(dir)}/${file}`;
    } catch {
      return null;
    }
  }

  private async withSession<T>(fn: (page: Page, context: BrowserContext) => Promise<T>): Promise<T> {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    let page: Page | undefined;
    try {
      const context = await browser.newContext({ locale: "tr-TR", userAgent: this.cfg.userAgent, acceptDownloads: true });
      context.setDefaultTimeout(this.cfg.timeoutMs);
      page = await context.newPage();
      if (this.cfg.blockAssets) {
        await page.route("**/*", (route) => (["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue()));
      }
      await this.login(page);
      return await fn(page, context);
    } catch (error) {
      const shot = await this.debugShot(page);
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("portal.failed", { supplier: this.ctx.supplier.code, error: message, screenshot: shot });
      const wrapped = error instanceof Error ? error : new Error(message);
      if (shot) wrapped.message = `${message} (ekran görüntüsü: ${shot})`;
      throw wrapped;
    } finally {
      await browser.close();
    }
  }

  private async scrape(page: Page, cfg: ScrapeConfig, maxPages: number): Promise<Record<string, string>[]> {
    const fields = cfg.fields as Record<string, FieldSpec | undefined>;
    const active = Object.fromEntries(Object.entries(fields).filter(([, f]) => f)) as Record<string, FieldSpec>;
    const seen = new Set<string>();
    const all: Record<string, string>[] = [];

    for (const listUrl of cfg.listUrls) {
      const p = cfg.pagination;
      for (let i = 0; i < Math.min(p.maxPages, maxPages); i++) {
        if (p.type === "urlTemplate") await page.goto(this.url(listUrl.replace("{page}", String(p.startPage + i))));
        else if (i === 0) await page.goto(this.url(listUrl));

        try {
          // İlk sayfa tam süre bekler (JS ile yüklenen listeler); sonraki boş sayfalar hızlı sonlanır.
          await page.waitForSelector(cfg.itemSelector, { timeout: i === 0 ? this.cfg.timeoutMs : 3_000 });
        } catch {
          if (i === 0 && (await this.hasCaptcha(page))) throw new CaptchaDetectedError("Ürün sayfasında CAPTCHA çıktı; durduruldu.");
          break; // bu listede başka ürün yok
        }

        const raw = await page.$$eval(
          cfg.itemSelector,
          (els, specs) =>
            els.map((el) => {
              const out: Record<string, string> = {};
              for (const [name, spec] of Object.entries(specs)) {
                const target = spec.selector ? el.querySelector(spec.selector) : el;
                let value: string | null = null;
                if (target) {
                  if (spec.attr === "text") value = target.textContent;
                  else if (spec.attr === "href") value = (target as HTMLAnchorElement).href || target.getAttribute("href");
                  else if (spec.attr === "src") value = (target as HTMLImageElement).src || target.getAttribute("src");
                  else value = target.getAttribute(spec.attr);
                }
                out[name] = (value ?? "").replace(/\s+/g, " ").trim();
              }
              return out;
            }),
          active,
        );
        const records = applyFieldRegex(raw, active);
        const fresh = records.filter((r) => r.supplierSku && !seen.has(r.supplierSku));
        // Site aynı sayfayı tekrar gösteriyorsa (son sayfa) döngüden çık.
        if (records.length > 0 && fresh.length === 0) break;
        for (const r of fresh) seen.add(r.supplierSku);
        all.push(...records.filter((r) => !r.supplierSku || fresh.includes(r)));

        if (p.type === "none") break;
        await sleep(this.cfg.throttleMs);
        if (p.type === "nextButton") {
          const next = page.locator(p.nextSelector!).first();
          if ((await next.count()) === 0 || (await next.isDisabled().catch(() => true))) break;
          await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => undefined), next.click()]);
        }
      }
    }
    return all;
  }

  private async download(page: Page, context: BrowserContext, cfg: z.infer<typeof downloadSchema>): Promise<unknown[]> {
    let data: Buffer;
    if (cfg.exportUrl) {
      const res = await context.request.get(this.url(cfg.exportUrl), { timeout: Math.max(this.cfg.timeoutMs, 120_000) });
      if (!res.ok()) throw new Error(`Dışa aktarım dosyası indirilemedi (HTTP ${res.status()})`);
      data = await res.body();
    } else {
      await page.goto(this.url(cfg.exportPageUrl!));
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.click(cfg.exportClickSelector!)]);
      const file = await dl.path();
      data = await readFile(file);
    }
    if (cfg.format === "xlsx") return parseXlsx(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    const text = new TextDecoder(cfg.encoding).decode(data);
    return parseFeedRecords(text, { format: cfg.format, itemPath: cfg.itemPath, csvDelimiter: cfg.csvDelimiter });
  }

  private identityMap() {
    const p = this.cfg.products;
    if (p.mode === "download") return p.fieldMap;
    const keys = Object.keys(p.fields).filter((k) => p.fields[k as keyof typeof p.fields]);
    return Object.fromEntries(keys.map((k) => [k, k])) as z.infer<typeof fieldMapSchema>;
  }

  private async collect(maxPages = Number.MAX_SAFE_INTEGER) {
    return this.withSession(async (page, context) => {
      const p = this.cfg.products;
      const records = p.mode === "scrape" ? await this.scrape(page, p, maxPages) : await this.download(page, context, p);
      return normalizeRecords(records, { fieldMap: this.identityMap(), priceFormat: this.cfg.priceFormat });
    });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const { items, errors } = await this.collect(1);
      const firstError = errors[0] ? ` İlk hata: ${errors[0].row} → ${errors[0].message}` : "";
      return {
        ok: items.length > 0,
        message: items.length
          ? `Giriş başarılı. İlk sayfada ${items.length} ürün okundu, ${errors.length} satır hatalı.${firstError}`
          : `Giriş başarılı ama ürün okunamadı: itemSelector/alan seçicilerini kontrol edin.${firstError}`,
        sample: items.slice(0, 5).map(({ raw: _raw, ...rest }) => rest),
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async *fetchProducts(): AsyncIterable<ProductBatch> {
    const { items, errors } = await this.collect();
    for (let i = 0; i < Math.max(items.length, 1); i += BATCH) yield { items: items.slice(i, i + BATCH), errors: i === 0 ? errors : ([] as RowError[]) };
  }

  async *fetchStockAndPrices(): AsyncIterable<StockBatch> {
    for await (const batch of this.fetchProducts()) yield { items: batch.items.map(toStockUpdate), errors: batch.errors };
  }

  async createOrder(): Promise<never> {
    throw new AdapterNotSupportedError(this.key, "createOrder");
  }
  async getOrderStatus(): Promise<never> {
    throw new AdapterNotSupportedError(this.key, "getOrderStatus");
  }
  async getTracking(): Promise<never> {
    throw new AdapterNotSupportedError(this.key, "getTracking");
  }
}
