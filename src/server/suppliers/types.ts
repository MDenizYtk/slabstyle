/**
 * Tedarikçi entegrasyon sözleşmesi.
 *
 * Her tedarikçi, veri formatı ne olursa olsun (REST, XML, CSV, JSON, manuel dosya)
 * bu arayüzü uygulayan bir adapter ile sisteme bağlanır. Sistemin geri kalanı
 * yalnızca normalize edilmiş tiplerle çalışır; bir tedarikçinin API'si değiştiğinde
 * yalnızca o tedarikçinin adapter'ı ya da config'i değişir.
 */

export type NormalizedProduct = {
  supplierSku: string;
  title: string;
  description?: string | null;
  brand?: string | null;
  gtin?: string | null;
  mpn?: string | null;
  categoryPath?: string | null;
  imageUrls?: string[];
  attributes?: Record<string, string>;
  /** Alış fiyatı, KDV dahil, kuruş. */
  costPrice: number;
  currency?: string;
  stock: number;
  leadTimeDays?: number | null;
  /** Tedarikçinin ürünü satışta göstermediği durum. */
  isActive?: boolean;
  raw?: unknown;
};

export type StockPriceUpdate = {
  supplierSku: string;
  stock?: number;
  costPrice?: number;
  isActive?: boolean;
};

/** Satır bazlı hata: tek bir bozuk kayıt tüm senkronizasyonu düşürmez. */
export type RowError = { row: number | string; message: string };

export type ProductBatch = { items: NormalizedProduct[]; errors: RowError[] };
export type StockBatch = { items: StockPriceUpdate[]; errors: RowError[] };

export type SupplierOrderPayload = {
  /** Bizim SupplierOrder id'miz; tedarikçide idempotency referansı olarak kullanılır. */
  reference: string;
  orderNumber: number;
  items: { supplierSku: string; quantity: number; unitCost: number }[];
  shippingAddress: {
    fullName: string;
    phone: string;
    line1: string;
    line2?: string | null;
    district: string;
    city: string;
    postalCode?: string | null;
    country: string;
  };
  customerEmail: string;
  note?: string | null;
};

export type ExternalOrderStatus = "RECEIVED" | "ACCEPTED" | "REJECTED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "UNKNOWN";

export type CreateOrderResult = { externalOrderId: string; status: ExternalOrderStatus; raw?: unknown };
export type OrderStatusResult = { status: ExternalOrderStatus; message?: string; raw?: unknown };

export type TrackingInfo = {
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string | null;
  status: "LABEL_CREATED" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "RETURNED" | "EXCEPTION";
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  events?: { at: string; description: string }[];
};

export type ConnectionTestResult = { ok: boolean; message: string; sample?: Partial<NormalizedProduct>[] };

export type AdapterCapabilities = {
  products: boolean;
  stockPrice: boolean;
  orders: boolean;
  orderStatus: boolean;
  tracking: boolean;
  webhooks: boolean;
};

/** Tedarikçiden gelen webhook'un normalize edilmiş hali (kargo, sipariş durumu). */
export type SupplierWebhookEvent =
  | { kind: "tracking"; eventId: string; externalOrderId: string; tracking: TrackingInfo }
  | { kind: "order_status"; eventId: string; externalOrderId: string; status: ExternalOrderStatus; message?: string }
  | { kind: "stock"; eventId: string; updates: StockPriceUpdate[] };

export interface SupplierAdapter {
  readonly key: string;
  readonly capabilities: AdapterCapabilities;

  testConnection(): Promise<ConnectionTestResult>;

  /** Tam katalog; büyük kataloglar için sayfa sayfa (batch) döner. */
  fetchProducts(): AsyncIterable<ProductBatch>;

  /** Yalnızca stok ve fiyat (hafif, sık çalışan senkronizasyon). */
  fetchStockAndPrices(): AsyncIterable<StockBatch>;

  createOrder(payload: SupplierOrderPayload): Promise<CreateOrderResult>;
  getOrderStatus(externalOrderId: string): Promise<OrderStatusResult>;
  getTracking(externalOrderId: string): Promise<TrackingInfo[]>;

  /** İsteğe bağlı: tedarikçinin gönderdiği webhook'u doğrular ve çözümler. */
  parseWebhook?(rawBody: string, headers: Headers): Promise<SupplierWebhookEvent | null>;
}

export class AdapterNotSupportedError extends Error {
  constructor(adapterKey: string, operation: string) {
    super(`"${adapterKey}" adapter'ı "${operation}" işlemini desteklemiyor`);
  }
}

export class AdapterConfigError extends Error {}
