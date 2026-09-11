import { z } from "zod";
import type { AdapterContext } from "../registry";
import { AdapterNotSupportedError, type ProductBatch, type StockBatch, type SupplierAdapter } from "../types";

/**
 * Kendi stoğunuz veya dış bağlantısı olmayan tedarikçiler: ürün, maliyet ve stok
 * admin panelinden elle girilir ya da dosya ile yüklenir. Siparişler manuel
 * hazırlanır. Otomatik senkronizasyon yoktur.
 */
export const manualConfigSchema = z
  .object({
    fieldMap: z.record(z.string(), z.string()).optional(),
    priceFormat: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export class ManualSupplierAdapter implements SupplierAdapter {
  readonly key = "manual";
  readonly capabilities = { products: false, stockPrice: false, orders: false, orderStatus: false, tracking: false, webhooks: false };

  constructor(_ctx: AdapterContext) {}

  async testConnection() {
    return { ok: true, message: "Manuel tedarikçi: bağlantı gerekmez. Ürünler admin panelinden veya dosyayla eklenir." };
  }
  async *fetchProducts(): AsyncIterable<ProductBatch> {}
  async *fetchStockAndPrices(): AsyncIterable<StockBatch> {}
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
