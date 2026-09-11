import { z } from "zod";
import { fieldMapSchema, getPath, priceFormatSchema, toStockUpdate } from "../mapping";
import { normalizeRecords } from "./feed";
import { supplierFetch } from "../http";
import type { AdapterContext } from "../registry";
import {
  AdapterNotSupportedError,
  type CreateOrderResult,
  type ExternalOrderStatus,
  type OrderStatusResult,
  type ProductBatch,
  type StockBatch,
  type SupplierAdapter,
  type SupplierOrderPayload,
  type TrackingInfo,
} from "../types";

/**
 * Genel REST adapter'ı. Sayfalı JSON API'lerin çoğu yalnızca config ile
 * bağlanabilir. API'si bu kalıba uymayan tedarikçiler için bu sınıf extend
 * edilerek "custom" adapter yazılır (bkz. docs/SUPPLIER_INTEGRATION.md).
 *
 * Gerçek tedarikçi URL'leri config'den gelir; burada hiçbir URL sabit değildir.
 */

const endpointSchema = z.object({
  path: z.string().min(1),
  method: z.enum(["GET", "POST"]).default("GET"),
  itemsPath: z.string().optional(),
});

export const restConfigSchema = z.object({
  baseUrl: z.url(),
  auth: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("none") }),
      z.object({ type: z.literal("bearer") }), // credentials.token
      z.object({ type: z.literal("header"), header: z.string() }), // credentials.token
      z.object({ type: z.literal("basic") }), // credentials.username/password
    ])
    .default({ type: "bearer" }),
  pagination: z
    .object({
      type: z.enum(["none", "page", "offset", "cursor"]).default("page"),
      pageParam: z.string().default("page"),
      sizeParam: z.string().default("limit"),
      size: z.number().int().min(1).max(1000).default(200),
      cursorPath: z.string().optional(),
      cursorParam: z.string().default("cursor"),
      maxPages: z.number().int().min(1).max(10_000).default(2000),
    })
    .default({ type: "page", pageParam: "page", sizeParam: "limit", size: 200, cursorParam: "cursor", maxPages: 2000 }),
  products: endpointSchema,
  stock: endpointSchema.optional(),
  fieldMap: fieldMapSchema,
  priceFormat: priceFormatSchema.default({ decimalSeparator: ".", vatIncluded: true, vatRateBps: 2000, inMinorUnits: false, currency: "TRY" }),
  orders: z
    .object({
      create: endpointSchema.extend({ externalIdPath: z.string().default("id") }),
      status: endpointSchema.extend({ statusPath: z.string().default("status") }).optional(),
      tracking: endpointSchema
        .extend({ carrierPath: z.string(), numberPath: z.string(), urlPath: z.string().optional(), statusPath: z.string().optional() })
        .optional(),
      /** Tedarikçinin durum kodlarını bizimkine çevirir: { "3": "SHIPPED" } */
      statusMap: z.record(z.string(), z.enum(["RECEIVED", "ACCEPTED", "REJECTED", "SHIPPED", "DELIVERED", "CANCELLED"])).default({}),
    })
    .optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
});

export type RestConfig = z.infer<typeof restConfigSchema>;

export class RestSupplierAdapter implements SupplierAdapter {
  readonly key: string;
  readonly capabilities;
  protected readonly cfg: RestConfig;

  constructor(protected readonly ctx: AdapterContext, key = "generic-rest") {
    this.key = key;
    this.cfg = restConfigSchema.parse(ctx.supplier.config);
    this.capabilities = {
      products: true,
      stockPrice: true,
      orders: Boolean(this.cfg.orders?.create),
      orderStatus: Boolean(this.cfg.orders?.status),
      tracking: Boolean(this.cfg.orders?.tracking),
      webhooks: false,
    };
  }

  protected headers(): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json" };
    const { auth } = this.cfg;
    const { token = "", username = "", password = "" } = this.ctx.credentials;
    if (auth.type === "bearer") h.authorization = `Bearer ${token}`;
    if (auth.type === "header") h[auth.header] = token;
    if (auth.type === "basic") h.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    return h;
  }

  protected async request(path: string, init: { method?: "GET" | "POST"; query?: Record<string, string>; body?: unknown } = {}) {
    const url = new URL(path.replace(/^\//, ""), this.cfg.baseUrl.endsWith("/") ? this.cfg.baseUrl : `${this.cfg.baseUrl}/`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    const res = await supplierFetch({
      url: url.toString(),
      method: init.method ?? "GET",
      headers: { ...this.headers(), ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      timeoutMs: this.cfg.timeoutMs,
      // POST istekleri (sipariş) otomatik tekrar edilmez: çift sipariş riskini önlemek için
      // tekrar kararı kuyruk seviyesinde, referans kontrolüyle verilir.
      retries: init.method === "POST" ? 0 : 2,
    });
    return res.text ? (JSON.parse(res.text) as unknown) : null;
  }

  protected async *paginate(endpoint: z.infer<typeof endpointSchema>): AsyncIterable<unknown[]> {
    const p = this.cfg.pagination;
    let page = 1;
    let offset = 0;
    let cursor: string | undefined;
    for (let i = 0; i < p.maxPages; i++) {
      const query: Record<string, string> = {};
      if (p.type !== "none") query[p.sizeParam] = String(p.size);
      if (p.type === "page") query[p.pageParam] = String(page);
      if (p.type === "offset") query[p.pageParam] = String(offset);
      if (p.type === "cursor" && cursor) query[p.cursorParam] = cursor;

      const body = await this.request(endpoint.path, { method: endpoint.method, query });
      const node = endpoint.itemsPath ? getPath(body, endpoint.itemsPath) : body;
      const items = Array.isArray(node) ? node : [];
      yield items;

      if (p.type === "none" || items.length === 0) return;
      if (p.type === "cursor") {
        const next = p.cursorPath ? getPath(body, p.cursorPath) : undefined;
        if (!next) return;
        cursor = String(next);
      } else if (items.length < p.size) return;
      page++;
      offset += items.length;
    }
  }

  async testConnection() {
    try {
      const first = await this.paginate(this.cfg.products)[Symbol.asyncIterator]().next();
      const records = (first.value as unknown[] | undefined) ?? [];
      const { items, errors } = normalizeRecords(records.slice(0, 20), this.cfg);
      return {
        ok: items.length > 0,
        message: `İlk sayfada ${records.length} kayıt; ilk 20 kayıttan ${items.length} geçerli, ${errors.length} hatalı.`,
        sample: items.slice(0, 3).map(({ raw: _raw, ...p }) => p),
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  protected async *productsFrom(endpoint: z.infer<typeof endpointSchema>): AsyncIterable<ProductBatch> {
    let offset = 0;
    for await (const records of this.paginate(endpoint)) {
      const { items, errors } = normalizeRecords(records, this.cfg);
      yield { items, errors: errors.map((e) => ({ ...e, row: typeof e.row === "number" ? e.row + offset : e.row })) };
      offset += records.length;
    }
  }

  fetchProducts(): AsyncIterable<ProductBatch> {
    return this.productsFrom(this.cfg.products);
  }

  async *fetchStockAndPrices(): AsyncIterable<StockBatch> {
    for await (const batch of this.productsFrom(this.cfg.stock ?? this.cfg.products)) {
      yield { items: batch.items.map(toStockUpdate), errors: batch.errors };
    }
  }

  protected mapStatus(raw: unknown): ExternalOrderStatus {
    const key = String(raw ?? "");
    return this.cfg.orders?.statusMap[key] ?? "UNKNOWN";
  }

  async createOrder(payload: SupplierOrderPayload): Promise<CreateOrderResult> {
    const create = this.cfg.orders?.create;
    if (!create) throw new AdapterNotSupportedError(this.key, "createOrder");
    const body = await this.request(create.path, { method: "POST", body: payload });
    const externalOrderId = getPath(body, create.externalIdPath);
    if (!externalOrderId) throw new Error("Tedarikçi yanıtında sipariş numarası yok");
    return { externalOrderId: String(externalOrderId), status: "RECEIVED", raw: body };
  }

  async getOrderStatus(externalOrderId: string): Promise<OrderStatusResult> {
    const ep = this.cfg.orders?.status;
    if (!ep) throw new AdapterNotSupportedError(this.key, "getOrderStatus");
    const body = await this.request(ep.path.replace("{id}", encodeURIComponent(externalOrderId)));
    return { status: this.mapStatus(getPath(body, ep.statusPath)), raw: body };
  }

  async getTracking(externalOrderId: string): Promise<TrackingInfo[]> {
    const ep = this.cfg.orders?.tracking;
    if (!ep) throw new AdapterNotSupportedError(this.key, "getTracking");
    const body = await this.request(ep.path.replace("{id}", encodeURIComponent(externalOrderId)));
    const nodes = ep.itemsPath ? getPath(body, ep.itemsPath) : body;
    return (Array.isArray(nodes) ? nodes : [nodes]).flatMap((n) => {
      const number = getPath(n, ep.numberPath);
      if (!number) return [];
      const mapped = this.mapStatus(ep.statusPath ? getPath(n, ep.statusPath) : undefined);
      return [{
        carrier: String(getPath(n, ep.carrierPath) ?? "Kargo"),
        trackingNumber: String(number),
        trackingUrl: ep.urlPath ? String(getPath(n, ep.urlPath) ?? "") || null : null,
        status: mapped === "DELIVERED" ? "DELIVERED" : "IN_TRANSIT",
      } satisfies TrackingInfo];
    });
  }
}
