import { z } from "zod";
import { fieldMapSchema, mapRecord, priceFormatSchema, toStockUpdate } from "../mapping";
import { detectDelimiter, parseCsv, parseJsonRecords, parseXmlRecords } from "../parsers";
import { supplierFetch } from "../http";
import type { AdapterContext } from "../registry";
import {
  AdapterNotSupportedError,
  type NormalizedProduct,
  type ProductBatch,
  type RowError,
  type StockBatch,
  type SupplierAdapter,
} from "../types";

/**
 * Genel feed adapter'ı (XML / CSV / JSON). Tedarikçinin yayınladığı dosya URL'si
 * ve alan eşlemesi admin panelinden girilir; kod değişikliği gerekmez.
 *
 * Sipariş iletimi feed'lerde yoktur: bu tedarikçilerin siparişleri admin
 * panelinden manuel gönderilir (capabilities.orders = false).
 */

const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("basic") }), // credentials: username, password
  z.object({ type: z.literal("header"), header: z.string().min(1) }), // credentials: token
  z.object({ type: z.literal("query"), param: z.string().min(1) }), // credentials: token
]);

export const feedConfigSchema = z.object({
  format: z.enum(["xml", "csv", "json"]),
  /** Tam katalog feed'i. */
  productsUrl: z.url(),
  /** İsteğe bağlı hafif stok/fiyat feed'i; yoksa katalog feed'i kullanılır. */
  stockUrl: z.url().optional(),
  itemPath: z.string().optional(),
  csvDelimiter: z.string().max(1).optional(),
  fieldMap: fieldMapSchema,
  stockFieldMap: fieldMapSchema.partial().optional(),
  priceFormat: priceFormatSchema.default({ decimalSeparator: ".", vatIncluded: true, vatRateBps: 2000, inMinorUnits: false, currency: "TRY" }),
  auth: authSchema.default({ type: "none" }),
  timeoutMs: z.number().int().min(1000).max(300_000).default(60_000),
});

export type FeedConfig = z.infer<typeof feedConfigSchema>;

const BATCH = 500;

export function parseFeedRecords(text: string, cfg: Pick<FeedConfig, "format" | "itemPath" | "csvDelimiter">): unknown[] {
  switch (cfg.format) {
    case "csv":
      return parseCsv(text, cfg.csvDelimiter || detectDelimiter(text));
    case "xml":
      if (!cfg.itemPath) throw new Error("XML feed için itemPath gerekli (ör. Urunler.Urun)");
      return parseXmlRecords(text, cfg.itemPath);
    case "json":
      return parseJsonRecords(text, cfg.itemPath);
  }
}

/** Kayıtları normalize eder; hatalı satırları ayrı toplar. */
export function normalizeRecords(records: unknown[], cfg: Pick<FeedConfig, "fieldMap" | "priceFormat">) {
  const items: NormalizedProduct[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  records.forEach((record, i) => {
    const res = mapRecord(record, cfg.fieldMap, cfg.priceFormat, i + 1);
    if (!res.ok) return errors.push(res.error);
    if (seen.has(res.product.supplierSku)) return errors.push({ row: res.product.supplierSku, message: "Tekrarlanan SKU (ilk kayıt kullanıldı)" });
    seen.add(res.product.supplierSku);
    items.push(res.product);
  });
  return { items, errors };
}

export class FeedSupplierAdapter implements SupplierAdapter {
  readonly key: string;
  readonly capabilities = { products: true, stockPrice: true, orders: false, orderStatus: false, tracking: false, webhooks: false };
  private readonly cfg: FeedConfig;

  constructor(private readonly ctx: AdapterContext, key = "generic-feed") {
    this.key = key;
    this.cfg = feedConfigSchema.parse(ctx.supplier.config);
  }

  private async download(rawUrl: string): Promise<string> {
    const url = new URL(rawUrl);
    const headers: Record<string, string> = {};
    const auth = this.cfg.auth;
    if (auth.type === "basic") {
      const { username = "", password = "" } = this.ctx.credentials;
      headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    } else if (auth.type === "header") {
      headers[auth.header] = this.ctx.credentials.token ?? "";
    } else if (auth.type === "query") {
      url.searchParams.set(auth.param, this.ctx.credentials.token ?? "");
    }
    const res = await supplierFetch({ url: url.toString(), headers, timeoutMs: this.cfg.timeoutMs });
    return res.text;
  }

  private async load(url: string) {
    const records = parseFeedRecords(await this.download(url), this.cfg);
    return normalizeRecords(records, this.cfg);
  }

  async testConnection() {
    try {
      const { items, errors } = await this.load(this.cfg.productsUrl);
      return {
        ok: items.length > 0,
        message: `${items.length} ürün okundu, ${errors.length} satır hatalı.${errors[0] ? ` İlk hata: ${errors[0].message}` : ""}`,
        sample: items.slice(0, 3).map(({ raw: _raw, ...p }) => p),
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async *fetchProducts(): AsyncIterable<ProductBatch> {
    const { items, errors } = await this.load(this.cfg.productsUrl);
    for (let i = 0; i < Math.max(items.length, 1); i += BATCH) {
      yield { items: items.slice(i, i + BATCH), errors: i === 0 ? errors : [] };
    }
  }

  async *fetchStockAndPrices(): AsyncIterable<StockBatch> {
    const url = this.cfg.stockUrl ?? this.cfg.productsUrl;
    const fieldMap = { ...this.cfg.fieldMap, ...(this.cfg.stockFieldMap ?? {}) };
    const records = parseFeedRecords(await this.download(url), this.cfg);
    const { items, errors } = normalizeRecords(records, { fieldMap, priceFormat: this.cfg.priceFormat });
    for (let i = 0; i < Math.max(items.length, 1); i += BATCH) {
      yield { items: items.slice(i, i + BATCH).map(toStockUpdate), errors: i === 0 ? errors : [] };
    }
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
