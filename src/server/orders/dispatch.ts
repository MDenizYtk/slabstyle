import { z } from "zod";
import { allocateQuantity } from "@/domain/sourcing/allocate";
import type { SupplierOffer } from "@/domain/sourcing/select-offer";
import {
  advanceSupplierStatus,
  deriveOrderStatus,
  mapExternalStatus,
  statusFromShipments,
  type SupplierOrderStatusCode,
} from "@/domain/orders/lifecycle";
import type { DbClient } from "../db";
import { audit } from "../audit";
import { logger } from "../logger";
import { createAdapter } from "../suppliers/registry";
import type { SupplierAdapter, TrackingInfo } from "../suppliers/types";
import { releaseReservations } from "./reservations";

/**
 * Ödeme sonrası sipariş akışı:
 *   Order (PAID) → tedarikçi seçimi → SupplierOrder'lar → tedarikçiye iletim
 *   → kargo takibi → Order durumu türetilir.
 */

type AdapterFactory = (supplier: Parameters<typeof createAdapter>[0]) => SupplierAdapter;

type OfferWithMeta = SupplierOffer & { supplierSku: string };

async function loadOffers(db: DbClient, variantIds: string[]): Promise<Map<string, OfferWithMeta[]>> {
  const rows = await db.supplierProduct.findMany({
    where: { variantId: { in: variantIds } },
    select: {
      id: true, variantId: true, supplierId: true, supplierSku: true, costPrice: true, stock: true, leadTimeDays: true, status: true,
      supplier: { select: { status: true, safetyStock: true, priority: true, defaultLeadTimeDays: true } },
    },
  });
  const map = new Map<string, OfferWithMeta[]>();
  for (const r of rows) {
    const list = map.get(r.variantId!) ?? [];
    list.push({
      supplierProductId: r.id,
      supplierId: r.supplierId,
      supplierSku: r.supplierSku,
      cost: r.costPrice,
      stock: r.stock,
      safetyStock: r.supplier.safetyStock,
      leadTimeDays: r.leadTimeDays ?? r.supplier.defaultLeadTimeDays,
      supplierPriority: r.supplier.priority,
      isAvailable: r.status === "ACTIVE" && r.supplier.status === "ACTIVE",
    });
    map.set(r.variantId!, list);
  }
  return map;
}

/** Tedarikçi otomatik sipariş alabiliyor mu? (ayar açık + adapter destekliyor) */
async function dispatchModeFor(db: DbClient, supplierId: string, factory: AdapterFactory): Promise<"AUTO" | "MANUAL"> {
  const s = await db.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { id: true, code: true, adapterKey: true, config: true, credentialsEncrypted: true, autoSubmitOrders: true } });
  if (!s.autoSubmitOrders) return "MANUAL";
  try {
    return factory(s).capabilities.orders ? "AUTO" : "MANUAL";
  } catch {
    return "MANUAL";
  }
}

export async function allocateOrder(db: DbClient, orderId: string, factory: AdapterFactory = createAdapter) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, status: true,
      items: { where: { supplierOrderId: null }, select: { id: true, variantId: true, quantity: true, unitPrice: true, unitCost: true, productName: true, variantName: true, sku: true, taxRateBps: true, reservationReleased: true } },
    },
  });
  if (!order || !["PAID", "PROCESSING"].includes(order.status) || order.items.length === 0) return { supplierOrderIds: [] as string[], unallocated: 0 };

  const offers = await loadOffers(db, order.items.map((i) => i.variantId).filter((v): v is string => v !== null));
  const modes = new Map<string, "AUTO" | "MANUAL">();
  for (const list of offers.values()) for (const o of list) if (!modes.has(o.supplierId)) modes.set(o.supplierId, await dispatchModeFor(db, o.supplierId, factory));

  const touched = new Set<string>();
  let unallocatedTotal = 0;

  await db.$transaction(async (tx) => {
    for (const item of order.items) {
      const { allocations, unallocated } = item.variantId ? allocateQuantity(offers.get(item.variantId) ?? [], item.quantity) : { allocations: [], unallocated: item.quantity };

      for (const [i, a] of allocations.entries()) {
        const mode = modes.get(a.offer.supplierId) ?? "MANUAL";
        const so = await tx.supplierOrder.upsert({
          where: { orderId_supplierId: { orderId: order.id, supplierId: a.offer.supplierId } },
          create: { orderId: order.id, supplierId: a.offer.supplierId, dispatchMode: mode, status: mode === "AUTO" ? "PENDING" : "AWAITING_MANUAL" },
          update: {},
          select: { id: true },
        });
        touched.add(so.id);
        const data = { supplierOrderId: so.id, supplierProductId: a.offer.supplierProductId, unitCost: a.offer.cost, quantity: a.quantity, lineTotal: item.unitPrice * a.quantity };
        if (i === 0) await tx.orderItem.update({ where: { id: item.id }, data });
        else {
          await tx.orderItem.create({
            data: {
              orderId: order.id, variantId: item.variantId, productName: item.productName, variantName: item.variantName, sku: item.sku,
              unitPrice: item.unitPrice, taxRateBps: item.taxRateBps, reservationReleased: item.reservationReleased, ...data,
            },
          });
        }
      }

      if (unallocated > 0) {
        unallocatedTotal += unallocated;
        if (allocations.length > 0) {
          await tx.orderItem.create({
            data: {
              orderId: order.id, variantId: item.variantId, productName: item.productName, variantName: item.variantName, sku: item.sku,
              unitPrice: item.unitPrice, unitCost: item.unitCost, taxRateBps: item.taxRateBps, reservationReleased: item.reservationReleased,
              quantity: unallocated, lineTotal: item.unitPrice * unallocated,
            },
          });
        }
      }
    }

    for (const soId of touched) {
      const items = await tx.orderItem.findMany({ where: { supplierOrderId: soId }, select: { unitCost: true, quantity: true } });
      await tx.supplierOrder.update({ where: { id: soId }, data: { costTotal: items.reduce((s, i) => s + i.unitCost * i.quantity, 0) } });
    }
    const all = await tx.orderItem.findMany({ where: { orderId: order.id }, select: { unitCost: true, quantity: true } });
    await tx.order.update({ where: { id: order.id }, data: { status: "PROCESSING", costTotal: all.reduce((s, i) => s + i.unitCost * i.quantity, 0) } });
  });

  await audit({ action: "order.allocated", actorType: "SYSTEM", entityType: "Order", entityId: order.id, metadata: { supplierOrders: touched.size, unallocated: unallocatedTotal } });
  if (unallocatedTotal > 0) {
    await audit({ action: "order.unallocated", actorType: "SYSTEM", entityType: "Order", entityId: order.id, metadata: { quantity: unallocatedTotal } });
  }

  const autoIds = await db.supplierOrder.findMany({ where: { id: { in: [...touched] }, dispatchMode: "AUTO", status: "PENDING" }, select: { id: true } });
  return { supplierOrderIds: [...touched], autoSubmitIds: autoIds.map((s) => s.id), unallocated: unallocatedTotal };
}

const addressSchema = z.object({
  fullName: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string().nullish(),
  district: z.string(),
  city: z.string(),
  postalCode: z.string().nullish(),
  country: z.string().default("TR"),
});

async function loadSupplierOrder(db: DbClient, id: string) {
  return db.supplierOrder.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, orderId: true, status: true, externalOrderId: true,
      supplier: { select: { id: true, code: true, adapterKey: true, config: true, credentialsEncrypted: true } },
      order: { select: { number: true, email: true, shippingAddress: true, customerNote: true } },
      items: { select: { id: true, quantity: true, unitCost: true, supplierProduct: { select: { supplierSku: true } } } },
    },
  });
}

/** Tedarikçiye otomatik sipariş iletimi. Hata olursa FAILED yazılır ve hata fırlatılır (kuyruk tekrar dener). */
export async function submitSupplierOrder(db: DbClient, supplierOrderId: string, factory: AdapterFactory = createAdapter) {
  const claimed = await db.supplierOrder.updateMany({
    where: { id: supplierOrderId, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "SUBMITTING", attemptCount: { increment: 1 } },
  });
  if (claimed.count === 0) return null;
  const so = await loadSupplierOrder(db, supplierOrderId);

  try {
    const adapter = factory(so.supplier);
    if (!adapter.capabilities.orders) {
      await db.supplierOrder.update({ where: { id: so.id }, data: { status: "AWAITING_MANUAL", dispatchMode: "MANUAL" } });
      return "AWAITING_MANUAL" as const;
    }
    const missingSku = so.items.find((i) => !i.supplierProduct);
    if (missingSku) throw new Error("Tedarikçi SKU'su olmayan satır var");

    const result = await adapter.createOrder({
      reference: so.id,
      orderNumber: so.order.number,
      items: so.items.map((i) => ({ supplierSku: i.supplierProduct!.supplierSku, quantity: i.quantity, unitCost: i.unitCost })),
      shippingAddress: addressSchema.parse(so.order.shippingAddress),
      customerEmail: so.order.email,
      note: so.order.customerNote,
    });
    const status = mapExternalStatus(result.status) ?? "SUBMITTED";
    await db.supplierOrder.update({ where: { id: so.id }, data: { status, externalOrderId: result.externalOrderId, submittedAt: new Date(), lastError: null } });
    await releaseReservations(db, { supplierOrderId: so.id }, "consumed");
    await audit({ action: "supplier_order.submitted", actorType: "SYSTEM", entityType: "SupplierOrder", entityId: so.id, metadata: { externalOrderId: result.externalOrderId, supplier: so.supplier.code } });
    await recomputeOrderStatus(db, so.orderId);
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.supplierOrder.update({ where: { id: so.id }, data: { status: "FAILED", lastError: message.slice(0, 1000) } });
    await audit({ action: "supplier_order.failed", actorType: "SYSTEM", entityType: "SupplierOrder", entityId: so.id, metadata: { error: message.slice(0, 300) } });
    throw error;
  }
}

/** Admin tedarikçi paneline siparişi elle girdikten sonra işaretler. */
export async function markSubmittedManually(db: DbClient, supplierOrderId: string, externalOrderId: string, actorId: string) {
  const updated = await db.supplierOrder.updateMany({
    where: { id: supplierOrderId, status: { in: ["PENDING", "AWAITING_MANUAL", "FAILED"] } },
    data: { status: "SUBMITTED", dispatchMode: "MANUAL", externalOrderId: externalOrderId || null, submittedAt: new Date(), lastError: null },
  });
  if (updated.count === 0) return false;
  const so = await db.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrderId }, select: { orderId: true } });
  await releaseReservations(db, { supplierOrderId }, "consumed");
  await audit({ action: "supplier_order.submitted_manually", actorType: "USER", actorId, entityType: "SupplierOrder", entityId: supplierOrderId, metadata: { externalOrderId } });
  await recomputeOrderStatus(db, so.orderId);
  return true;
}

/** Kargo bilgisini uygular (tedarikçi API'si, webhook veya admin girişi). */
export async function applyTracking(db: DbClient, supplierOrderId: string, tracking: TrackingInfo[], actor: { type: "SYSTEM" | "USER" | "SUPPLIER"; id?: string } = { type: "SYSTEM" }) {
  const so = await db.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrderId }, select: { id: true, orderId: true, status: true } });
  for (const t of tracking) {
    const existing = await db.shipment.findUnique({ where: { carrier_trackingNumber: { carrier: t.carrier, trackingNumber: t.trackingNumber } }, select: { id: true, supplierOrderId: true } });
    if (existing && existing.supplierOrderId !== so.id) {
      logger.warn("shipment.conflict", { supplierOrderId, trackingNumber: t.trackingNumber });
      continue;
    }
    const data = {
      status: t.status,
      trackingUrl: t.trackingUrl ?? null,
      events: t.events ?? [],
      shippedAt: t.shippedAt ?? new Date(),
      deliveredAt: t.deliveredAt ?? (t.status === "DELIVERED" ? new Date() : null),
    };
    await db.shipment.upsert({
      where: { carrier_trackingNumber: { carrier: t.carrier, trackingNumber: t.trackingNumber } },
      create: { supplierOrderId: so.id, carrier: t.carrier, trackingNumber: t.trackingNumber, ...data },
      update: data,
    });
  }
  const shipments = await db.shipment.findMany({ where: { supplierOrderId: so.id }, select: { status: true } });
  const fromShipments = statusFromShipments(shipments.map((s) => s.status));
  if (fromShipments) {
    const next = advanceSupplierStatus(so.status as SupplierOrderStatusCode, fromShipments);
    if (next !== so.status) {
      await db.supplierOrder.update({ where: { id: so.id }, data: { status: next } });
      // İletim adımı atlanmışsa (ör. elle kargo girildi) rezervasyon burada tüketilir.
      await releaseReservations(db, { supplierOrderId: so.id }, "consumed");
    }
  }
  await audit({ action: "shipment.updated", actorType: actor.type, actorId: actor.id, entityType: "SupplierOrder", entityId: so.id, metadata: { count: tracking.length } });
  await recomputeOrderStatus(db, so.orderId);
}

/** Tedarikçiden sipariş durumu ve kargo bilgisini çeker. */
export async function pollSupplierOrder(db: DbClient, supplierOrderId: string, factory: AdapterFactory = createAdapter) {
  const so = await loadSupplierOrder(db, supplierOrderId);
  if (!so.externalOrderId || !["SUBMITTED", "ACCEPTED", "SHIPPED"].includes(so.status)) return;
  const adapter = factory(so.supplier);

  if (adapter.capabilities.orderStatus) {
    const res = await adapter.getOrderStatus(so.externalOrderId);
    const mapped = mapExternalStatus(res.status);
    if (mapped && (mapped === "REJECTED" || mapped === "CANCELLED" || mapped === "ACCEPTED")) {
      const next = advanceSupplierStatus(so.status as SupplierOrderStatusCode, mapped);
      if (next !== so.status) {
        await db.supplierOrder.update({ where: { id: so.id }, data: { status: next, lastError: mapped === "REJECTED" ? res.message ?? "Tedarikçi reddetti" : null } });
        await audit({ action: `supplier_order.${next.toLowerCase()}`, actorType: "SUPPLIER", entityType: "SupplierOrder", entityId: so.id });
      }
    }
  }
  if (adapter.capabilities.tracking) {
    const tracking = await adapter.getTracking(so.externalOrderId);
    if (tracking.length) await applyTracking(db, so.id, tracking, { type: "SUPPLIER" });
  }
  await recomputeOrderStatus(db, so.orderId);
}

export async function recomputeOrderStatus(db: DbClient, orderId: string) {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { status: true, supplierOrders: { select: { status: true } }, _count: { select: { items: { where: { supplierOrderId: null } } } } },
  });
  const next = deriveOrderStatus(order.status, order.supplierOrders.map((s) => s.status), order._count.items > 0);
  if (next !== order.status) {
    await db.order.update({ where: { id: orderId }, data: { status: next } });
    await audit({ action: "order.status_changed", actorType: "SYSTEM", entityType: "Order", entityId: orderId, metadata: { from: order.status, to: next } });
  }
  return next;
}
