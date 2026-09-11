/**
 * ─────────────────────────────────────────────────────────────────────────
 *  MOCK ADAPTER — GERÇEK BİR TEDARİKÇİYE BAĞLANMAZ, AĞ İSTEĞİ YAPMAZ.
 *  Veriler src/server/suppliers/mock/fixtures.ts içinde deterministik olarak
 *  üretilir. Geliştirme, test ve demo içindir.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { z } from "zod";
import { MOCK_SUPPLIERS, hashRandom, mockCatalogFor, type MockSupplierDef } from "../mock/fixtures";
import type { AdapterContext } from "../registry";
import type {
  CreateOrderResult,
  NormalizedProduct,
  OrderStatusResult,
  ProductBatch,
  StockBatch,
  SupplierAdapter,
  SupplierOrderPayload,
  SupplierWebhookEvent,
  TrackingInfo,
} from "../types";
import { AdapterConfigError } from "../types";

export const mockConfigSchema = z.object({
  mock: z.literal(true).default(true),
  dataset: z.string(),
  /** Hata senaryolarını test etmek için. */
  simulateFailure: z.enum(["none", "fetch", "order"]).default("none"),
  /** Senkronizasyonlar arasında fiyat/stok oynaması (dakika). */
  tickMinutes: z.number().int().min(1).default(15),
});

const BATCH = 10;

export class MockSupplierAdapter implements SupplierAdapter {
  readonly key = "mock";
  readonly capabilities = { products: true, stockPrice: true, orders: true, orderStatus: true, tracking: true, webhooks: true };
  private readonly def: MockSupplierDef;
  private readonly config: z.infer<typeof mockConfigSchema>;

  constructor(private readonly ctx: AdapterContext) {
    this.config = mockConfigSchema.parse(ctx.supplier.config);
    const def = MOCK_SUPPLIERS.find((s) => s.code === this.config.dataset);
    if (!def) throw new AdapterConfigError(`MOCK veri seti bulunamadı: ${this.config.dataset}`);
    this.def = def;
  }

  private catalog(): NormalizedProduct[] {
    if (this.config.simulateFailure === "fetch") throw new Error("MOCK: tedarikçi API'si yanıt vermedi (simülasyon)");
    const tick = Math.floor((this.ctx.now ?? Date.now()) / (this.config.tickMinutes * 60_000));
    return mockCatalogFor(this.def, tick).map((o) => ({
      supplierSku: o.supplierSku,
      title: o.title,
      brand: o.brandName,
      gtin: o.gtin,
      mpn: o.mpn,
      costPrice: o.costPrice,
      stock: o.stock,
      currency: "TRY",
      leadTimeDays: this.def.leadTimeDays,
      raw: { mock: true },
    }));
  }

  async testConnection() {
    const sample = this.catalog().slice(0, 3);
    return { ok: true, message: `MOCK bağlantı başarılı (${this.def.name}). Gerçek ağ isteği yapılmadı.`, sample };
  }

  async *fetchProducts(): AsyncIterable<ProductBatch> {
    const all = this.catalog();
    for (let i = 0; i < all.length; i += BATCH) yield { items: all.slice(i, i + BATCH), errors: [] };
  }

  async *fetchStockAndPrices(): AsyncIterable<StockBatch> {
    const all = this.catalog();
    for (let i = 0; i < all.length; i += BATCH) {
      yield { items: all.slice(i, i + BATCH).map((p) => ({ supplierSku: p.supplierSku, stock: p.stock, costPrice: p.costPrice })), errors: [] };
    }
  }

  async createOrder(payload: SupplierOrderPayload): Promise<CreateOrderResult> {
    if (this.config.simulateFailure === "order") throw new Error("MOCK: sipariş reddedildi (simülasyon)");
    // Aynı referans → aynı dış id: tekrar denemelerde çift sipariş oluşmaz.
    return { externalOrderId: `MOCK-${this.def.skuPrefix}-${payload.reference.slice(-10).toUpperCase()}`, status: "ACCEPTED" };
  }

  /** Sipariş id'sinden deterministik bir ilerleme: MOCK kargo hayat döngüsü. */
  private progress(externalOrderId: string) {
    return hashRandom(externalOrderId);
  }

  async getOrderStatus(externalOrderId: string): Promise<OrderStatusResult> {
    const p = this.progress(externalOrderId);
    return { status: p < 0.5 ? "SHIPPED" : "DELIVERED" };
  }

  async getTracking(externalOrderId: string): Promise<TrackingInfo[]> {
    const delivered = this.progress(externalOrderId) >= 0.5;
    const trackingNumber = `MOCK${externalOrderId.replace(/\D/g, "").padEnd(10, "7").slice(0, 10)}`;
    return [
      {
        carrier: "MOCK Kargo",
        trackingNumber,
        trackingUrl: null,
        status: delivered ? "DELIVERED" : "IN_TRANSIT",
        shippedAt: new Date(Date.now() - 86_400_000),
        deliveredAt: delivered ? new Date() : null,
        events: [{ at: new Date().toISOString(), description: delivered ? "Teslim edildi (MOCK)" : "Transfer merkezinde (MOCK)" }],
      },
    ];
  }

  async parseWebhook(rawBody: string): Promise<SupplierWebhookEvent | null> {
    const body = z
      .object({ id: z.string(), type: z.literal("tracking"), orderId: z.string(), carrier: z.string(), trackingNumber: z.string(), status: z.string() })
      .safeParse(JSON.parse(rawBody));
    if (!body.success) return null;
    const status = (["LABEL_CREATED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "EXCEPTION"] as const).find((s) => s === body.data.status) ?? "IN_TRANSIT";
    return {
      kind: "tracking",
      eventId: body.data.id,
      externalOrderId: body.data.orderId,
      tracking: { carrier: body.data.carrier, trackingNumber: body.data.trackingNumber, status, deliveredAt: status === "DELIVERED" ? new Date() : null },
    };
  }
}
