import { describe, expect, it } from "vitest";
import { allocateQuantity } from "@/domain/sourcing/allocate";
import type { SupplierOffer } from "@/domain/sourcing/select-offer";
import { advanceSupplierStatus, deriveOrderStatus, mapExternalStatus, statusFromShipments } from "@/domain/orders/lifecycle";
import { paymentStatusAfterRefund, refundAmountForItems, validateRefund } from "@/domain/payments/refund";
import { signWebhook, verifyWebhookSignature } from "@/server/payments/signature";

const offer = (id: string, cost: number, stock: number, extra: Partial<SupplierOffer> = {}): SupplierOffer => ({
  supplierProductId: id, supplierId: id.toUpperCase(), cost, stock, safetyStock: 0, leadTimeDays: 2, supplierPriority: 0, isAvailable: true, ...extra,
});

describe("tedarikçi dağıtımı", () => {
  it("tek tedarikçi tüm adedi karşılıyorsa bölünmez", () => {
    const r = allocateQuantity([offer("a", 500, 20), offer("b", 480, 5)], 3);
    expect(r).toEqual({ allocations: [{ offer: expect.objectContaining({ supplierId: "B" }), quantity: 3 }], unallocated: 0 });
  });
  it("ucuz tedarikçi yetmezse tümünü karşılayan diğerine gider (tek paket)", () => {
    const r = allocateQuantity([offer("a", 500, 20), offer("b", 480, 5)], 10);
    expect(r.allocations.map((a) => [a.offer.supplierId, a.quantity])).toEqual([["A", 10]]);
  });
  it("hiçbiri tek başına yetmezse bölünür", () => {
    const r = allocateQuantity([offer("a", 500, 6), offer("b", 480, 5)], 10);
    expect(r.allocations.map((a) => [a.offer.supplierId, a.quantity])).toEqual([["B", 5], ["A", 5]]);
    expect(r.unallocated).toBe(0);
  });
  it("toplam stok yetmezse kalan admin'e bırakılır", () => {
    const r = allocateQuantity([offer("a", 500, 2, { safetyStock: 1 })], 4);
    expect(r).toMatchObject({ unallocated: 3, allocations: [{ quantity: 1 }] });
  });
});

describe("sipariş durumu", () => {
  it("tüm paketler teslim → teslim edildi", () => {
    expect(deriveOrderStatus("PROCESSING", ["DELIVERED", "DELIVERED"])).toBe("DELIVERED");
  });
  it("biri kargoda biri hazırlanıyor → kısmen kargoda", () => {
    expect(deriveOrderStatus("PROCESSING", ["SHIPPED", "SUBMITTED"])).toBe("PARTIALLY_SHIPPED");
  });
  it("hepsi kargoda/teslim → kargoda", () => {
    expect(deriveOrderStatus("PROCESSING", ["SHIPPED", "DELIVERED"])).toBe("SHIPPED");
  });
  it("atanmamış ürün varken tamamlandı sayılmaz", () => {
    expect(deriveOrderStatus("PROCESSING", ["DELIVERED"], true)).toBe("PARTIALLY_SHIPPED");
  });
  it("ödeme bekleyen ve iptal edilen siparişler değişmez", () => {
    expect(deriveOrderStatus("PENDING_PAYMENT", ["SHIPPED"])).toBe("PENDING_PAYMENT");
    expect(deriveOrderStatus("CANCELLED", ["DELIVERED"])).toBe("CANCELLED");
  });
  it("iptal edilen alt sipariş hesaba katılmaz", () => {
    expect(deriveOrderStatus("PROCESSING", ["CANCELLED", "DELIVERED"])).toBe("DELIVERED");
  });
  it("durum geri gitmez", () => {
    expect(advanceSupplierStatus("DELIVERED", "SHIPPED")).toBe("DELIVERED");
    expect(advanceSupplierStatus("SUBMITTED", "SHIPPED")).toBe("SHIPPED");
    expect(advanceSupplierStatus("SHIPPED", "CANCELLED")).toBe("CANCELLED");
    expect(advanceSupplierStatus("CANCELLED", "DELIVERED")).toBe("CANCELLED");
  });
  it("dış durum eşleme ve kargo", () => {
    expect(mapExternalStatus("RECEIVED")).toBe("SUBMITTED");
    expect(mapExternalStatus("UNKNOWN")).toBeNull();
    expect(statusFromShipments(["DELIVERED", "IN_TRANSIT"])).toBe("SHIPPED");
    expect(statusFromShipments(["DELIVERED"])).toBe("DELIVERED");
    expect(statusFromShipments([])).toBeNull();
  });
});

describe("refund kuralları", () => {
  it("iade edilebilir tutarı aşamaz", () => {
    expect(validateRefund(5_000, 10_000, 6_000)).toMatchObject({ ok: false });
    expect(validateRefund(4_000, 10_000, 6_000)).toEqual({ ok: true });
  });
  it("sıfır/negatif ve tahsilatsız iade yok", () => {
    expect(validateRefund(0, 10_000, 0).ok).toBe(false);
    expect(validateRefund(100, 0, 0).ok).toBe(false);
  });
  it("kısmi / tam iade durumu", () => {
    expect(paymentStatusAfterRefund(10_000, 4_000)).toBe("PARTIALLY_REFUNDED");
    expect(paymentStatusAfterRefund(10_000, 10_000)).toBe("REFUNDED");
  });
  it("kalem tutarı", () => {
    expect(refundAmountForItems([{ unitPrice: 2_500, quantity: 2 }, { unitPrice: 1_000, quantity: 1 }])).toBe(6_000);
  });
});

describe("webhook imzası", () => {
  const secret = "s3cr3t";
  const body = '{"id":"evt_1"}';
  it("geçerli imza kabul edilir", () => {
    expect(verifyWebhookSignature(signWebhook(secret, body), body, secret)).toBe(true);
  });
  it("değiştirilmiş gövde reddedilir", () => {
    expect(verifyWebhookSignature(signWebhook(secret, body), '{"id":"evt_2"}', secret)).toBe(false);
  });
  it("yanlış anahtar reddedilir", () => {
    expect(verifyWebhookSignature(signWebhook("other", body), body, secret)).toBe(false);
  });
  it("eski zaman damgası (replay) reddedilir", () => {
    const old = signWebhook(secret, body, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyWebhookSignature(old, body, secret)).toBe(false);
  });
  it("bozuk başlık reddedilir", () => {
    expect(verifyWebhookSignature("garbage", body, secret)).toBe(false);
    expect(verifyWebhookSignature(null, body, secret)).toBe(false);
  });
});
