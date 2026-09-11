/**
 * Uçtan uca sipariş akışı (gerçek test veritabanı):
 * sepet → checkout → ödeme → imzalı webhook → tedarikçi seçimi → tedarikçiye
 * iletim (MOCK adapter) → kargo → teslim → iade → refund; ayrıca tekrar gelen
 * webhook, geçersiz imza, tutar uyuşmazlığı ve süresi dolan sipariş senaryoları.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { recalculateVariants } from "@/server/catalog/recalculate";
import { placeOrder, type PlaceOrderInput } from "@/server/orders/checkout";
import { applyTracking, pollSupplierOrder } from "@/server/orders/dispatch";
import { capturePayment, expireUnpaidOrders, getAvailablePaymentMethods, processPaymentWebhook, startPayment } from "@/server/payments/service";
import { buildMockWebhook } from "@/server/payments/providers/mock";
import { createRefund, RefundError } from "@/server/payments/refund";
import { SIGNATURE_HEADER } from "@/server/payments/signature";

let userId = "";
let variantId = "";
const address = { title: "Ev", fullName: "Test Müşteri", phone: "05551112233", line1: "Deneme Mah. Test Sk. No 1", district: "Çankaya", city: "Ankara" };

async function resetDatabase() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

async function inventory() {
  return db.inventory.findUniqueOrThrow({ where: { variantId }, select: { availableQty: true, reservedQty: true } });
}

async function newCart(quantity: number) {
  const cart = await db.cart.create({ data: { userId, items: { create: { variantId, quantity } } }, select: { id: true } });
  return cart.id;
}

const orderInput = (cartId: string, key: string): PlaceOrderInput => ({
  userId, email: "test@slabstyle.local", cartId, address, saveAddress: false, shippingMethod: "standard", idempotencyKey: key,
});

async function paymentWebhook(type: "payment.succeeded" | "payment.failed", providerPaymentId: string, amount: number, eventId: string) {
  const { body, headers } = buildMockWebhook({ id: eventId, type, data: { paymentId: providerPaymentId, amount, currency: "TRY" } });
  return { body, headers, result: await processPaymentWebhook(db, "mock", body, headers) };
}

beforeAll(async () => {
  await resetDatabase();
  const user = await db.user.create({ data: { email: "test@slabstyle.local", name: "Test", passwordHash: await hashPassword("TestSifre123") } });
  userId = user.id;
  const supplier = await db.supplier.create({
    data: { code: "mock-a", name: "MOCK A", status: "ACTIVE", integrationType: "MOCK", adapterKey: "mock", autoSubmitOrders: true, safetyStock: 2, config: { mock: true, dataset: "mock-a" } },
  });
  await db.pricingRule.create({ data: { name: "Test %25", scope: "GLOBAL", marginBps: 2500, rounding: "NONE" } });
  const product = await db.product.create({
    data: { slug: "test-urun", name: "Test Ürün", status: "ACTIVE", variants: { create: { sku: "SS-TEST-1", name: "500 ml", isDefault: true } } },
    include: { variants: true },
  });
  variantId = product.variants[0].id;
  await db.supplierProduct.create({
    data: { supplierId: supplier.id, supplierSku: "A-TEST-1", variantId, title: "Test", costPrice: 40_000, stock: 12, matchStatus: "MANUAL_MATCHED" },
  });
  await recalculateVariants(db, [variantId]);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("sipariş akışı", () => {
  let orderId = "";
  let providerPaymentId = "";
  let amount = 0;
  let firstEvent: { body: string; headers: Headers };

  it("fiyat kuraldan, stok safety stock düşülerek hesaplanır", async () => {
    const price = await db.price.findUniqueOrThrow({ where: { variantId } });
    expect(price.amount).toBe(50_000);
    expect(await inventory()).toEqual({ availableQty: 10, reservedQty: 0 });
  });

  it("checkout siparişi PENDING_PAYMENT açar ve stoğu ayırır", async () => {
    const cartId = await newCart(2);
    const res = await placeOrder(db, orderInput(cartId, "key-order-1-aaaaaaaaaa"));
    expect(res.created).toBe(true);
    orderId = res.orderId;
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ status: "PENDING_PAYMENT", subtotal: 100_000, shippingTotal: 0, grandTotal: 100_000, costTotal: 80_000 });
    expect(await inventory()).toEqual({ availableQty: 8, reservedQty: 2 });
    expect((await db.cart.findUniqueOrThrow({ where: { id: cartId } })).status).toBe("CONVERTED");
  });

  it("aynı idempotency anahtarıyla ikinci gönderim yeni sipariş açmaz", async () => {
    const cartId = await newCart(1);
    const res = await placeOrder(db, orderInput(cartId, "key-order-1-aaaaaaaaaa"));
    expect(res).toEqual({ orderId, created: false });
    expect(await db.order.count()).toBe(1);
    await db.cart.delete({ where: { id: cartId } });
  });

  it("ödeme başlatılır; ödeme olmadan sipariş PAID olmaz", async () => {
    await startPayment(db, orderId, userId);
    const payment = await db.payment.findFirstOrThrow({ where: { orderId } });
    providerPaymentId = payment.providerPaymentId!;
    amount = payment.amount;
    expect(payment.status).toBe("PENDING");
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING_PAYMENT");
  });

  it("geçersiz imzalı webhook reddedilir ve hiçbir şey değişmez", async () => {
    const { body } = buildMockWebhook({ id: "evt_forged", type: "payment.succeeded", data: { paymentId: providerPaymentId, amount } });
    const res = await processPaymentWebhook(db, "mock", body, new Headers({ [SIGNATURE_HEADER]: "t=1,v1=" + "0".repeat(64) }));
    expect(res.status).toBe(401);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING_PAYMENT");
    expect(await db.webhookEvent.count()).toBe(0);
  });

  it("başarılı ödeme webhook'u → PAID → tedarikçi seçimi → tedarikçiye otomatik iletim", async () => {
    const { result, body, headers } = await paymentWebhook("payment.succeeded", providerPaymentId, amount, "evt_success_1");
    firstEvent = { body, headers };
    expect(result.status).toBe(200);

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { supplierOrders: true, payments: true } });
    expect(order.paidAt).not.toBeNull();
    expect(order.payments[0].status).toBe("CAPTURED");
    expect(order.status).toBe("PROCESSING");
    expect(order.supplierOrders).toHaveLength(1);
    expect(order.supplierOrders[0]).toMatchObject({ dispatchMode: "AUTO", status: "ACCEPTED" });
    expect(order.supplierOrders[0].externalOrderId).toMatch(/^MOCK-A-/);
    // İletimle rezerv tüketilir; satılabilir stok tedarikçinin bir sonraki senkronizasyonuna kadar düşük kalır.
    expect(await inventory()).toEqual({ availableQty: 8, reservedQty: 0 });
  });

  it("aynı webhook tekrar gelirse duplicate döner, sipariş/ödeme çoğalmaz", async () => {
    const again = await processPaymentWebhook(db, "mock", firstEvent.body, firstEvent.headers);
    expect(again).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    expect(await db.webhookEvent.count()).toBe(1);
    expect(await db.supplierOrder.count({ where: { orderId } })).toBe(1);
    expect(await db.payment.count({ where: { orderId, status: "CAPTURED" } })).toBe(1);
  });

  it("aynı ödeme için farklı olay numarasıyla gelen başarı da sonucu değiştirmez", async () => {
    const { result } = await paymentWebhook("payment.succeeded", providerPaymentId, amount, "evt_success_2");
    expect(result.status).toBe(200);
    expect((await db.webhookEvent.findFirstOrThrow({ where: { externalEventId: "evt_success_2" } })).status).toBe("IGNORED");
    expect(await db.supplierOrder.count({ where: { orderId } })).toBe(1);
  });

  it("kargo takibi tedarikçiden gelir, teslimde sipariş DELIVERED olur", async () => {
    const so = await db.supplierOrder.findFirstOrThrow({ where: { orderId } });
    await pollSupplierOrder(db, so.id);
    const shipments = await db.shipment.findMany({ where: { supplierOrderId: so.id } });
    expect(shipments).toHaveLength(1);
    expect(shipments[0].carrier).toBe("MOCK Kargo");

    await applyTracking(db, so.id, [{ carrier: "MOCK Kargo", trackingNumber: shipments[0].trackingNumber, status: "DELIVERED" }]);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { supplierOrders: true } });
    expect(order.supplierOrders[0].status).toBe("DELIVERED");
    expect(order.status).toBe("DELIVERED");
  });

  it("kısmi iade: tutar doğrulanır, aynı iade iki kez yapılmaz", async () => {
    const payment = await db.payment.findFirstOrThrow({ where: { orderId, status: "CAPTURED" } });
    await expect(createRefund(db, { paymentId: payment.id, amount: 200_000, reason: "fazla", idempotencyKey: "r-too-much" })).rejects.toBeInstanceOf(RefundError);

    const first = await createRefund(db, { paymentId: payment.id, amount: 50_000, reason: "1 ürün iade", idempotencyKey: "return:test-1" });
    const second = await createRefund(db, { paymentId: payment.id, amount: 50_000, reason: "1 ürün iade", idempotencyKey: "return:test-1" });
    expect(second.id).toBe(first.id);
    expect(first.status).toBe("SUCCEEDED");
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PARTIALLY_REFUNDED");
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PARTIALLY_REFUNDED");
    expect(await db.refund.count()).toBe(1);
  });
});

describe("ödeme sorunları", () => {
  it("tutar uyuşmazlığında sipariş PAID olmaz ve olay FAILED kalır", async () => {
    const cartId = await newCart(1);
    const { orderId } = await placeOrder(db, orderInput(cartId, "key-order-mismatch-aaaa"));
    await startPayment(db, orderId, userId);
    const payment = await db.payment.findFirstOrThrow({ where: { orderId } });
    const { result } = await paymentWebhook("payment.succeeded", payment.providerPaymentId!, payment.amount - 100, "evt_mismatch");
    expect(result.status).toBe(500);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING_PAYMENT");
    expect((await db.webhookEvent.findFirstOrThrow({ where: { externalEventId: "evt_mismatch" } })).status).toBe("FAILED");
  });

  it("başarısız ödeme siparişi açık bırakır, süresi dolunca iptal edilip stok geri döner", async () => {
    const before = await inventory();
    const cartId = await newCart(1);
    const { orderId } = await placeOrder(db, orderInput(cartId, "key-order-expire-aaaaaa"));
    await startPayment(db, orderId, userId);
    const payment = await db.payment.findFirstOrThrow({ where: { orderId } });
    await paymentWebhook("payment.failed", payment.providerPaymentId!, payment.amount, "evt_failed");
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("FAILED");
    expect(await inventory()).toEqual({ availableQty: before.availableQty - 1, reservedQty: before.reservedQty + 1 });

    await db.order.updateMany({ where: { status: "PENDING_PAYMENT" }, data: { createdAt: new Date(Date.now() - 3_600_000) } });
    expect(await expireUnpaidOrders(db, 30)).toBe(2);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CANCELLED");
    expect(await inventory()).toEqual({ availableQty: before.availableQty + 1, reservedQty: 0 });
  });

  it("havale: süresi dolmadan iptal edilmez, admin onayıyla tek sefer PAID olur ve tedarikçiye gider", async () => {
    await db.setting.upsert({
      where: { key: "bankTransfer" },
      create: { key: "bankTransfer", value: { enabled: true, accountHolder: "Test Ltd", bankName: "Test Bank", iban: "TR330006100519786457841326", note: "", expireHours: 48 } },
      update: { value: { enabled: true, accountHolder: "Test Ltd", bankName: "Test Bank", iban: "TR330006100519786457841326", note: "", expireHours: 48 } },
    });
    expect((await getAvailablePaymentMethods(db)).map((m) => m.id)).toContain("bank_transfer");

    const cartId = await newCart(1);
    const { orderId } = await placeOrder(db, orderInput(cartId, "key-order-bank-aaaaaaaa"));
    expect(await startPayment(db, orderId, userId, "bank_transfer")).toMatch(/^\/checkout\/transfer\//);

    // Kart siparişi 30 dk'da iptal olurdu; havale 48 saat bekler.
    await db.order.update({ where: { id: orderId }, data: { createdAt: new Date(Date.now() - 3_600_000) } });
    await expireUnpaidOrders(db, 30);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING_PAYMENT");

    const payment = await db.payment.findFirstOrThrow({ where: { orderId, provider: "bank_transfer" } });
    expect(await capturePayment(db, payment.id, { type: "USER" })).toBe("PAID");
    expect(await capturePayment(db, payment.id, { type: "USER" })).toBe("ALREADY_CAPTURED");

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { supplierOrders: true } });
    expect(order.status).toBe("PROCESSING");
    expect(order.supplierOrders).toHaveLength(1);
  });

  it("stok yetersizse sipariş oluşmaz ve hiçbir rezervasyon kalmaz", async () => {
    const before = await inventory();
    const cartId = await newCart(before.availableQty + 5);
    await expect(placeOrder(db, orderInput(cartId, "key-order-nostock-aaaaa"))).rejects.toThrow(/stok|stoğ/i);
    expect(await inventory()).toEqual(before);
  });
});
