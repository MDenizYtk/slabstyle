import { Prisma } from "@/generated/prisma/client";
import { advanceSupplierStatus, mapExternalStatus, type SupplierOrderStatusCode } from "@/domain/orders/lifecycle";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { applyTracking, recomputeOrderStatus } from "@/server/orders/dispatch";
import { SIGNATURE_HEADER, verifyWebhookSignature } from "@/server/payments/signature";
import { rateLimit } from "@/server/rate-limit";
import { applyStockUpdates } from "@/server/sync/engine";
import { createAdapter, decodeCredentials } from "@/server/suppliers/registry";

/**
 * Tedarikçi webhook'u (kargo, sipariş durumu, anlık stok). Tedarikçiye özel
 * gizli anahtar (credentials.webhookSecret) ile imzalanmış olmalıdır.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/suppliers/[code]">) {
  const { code } = await ctx.params;
  if (!/^[a-z0-9-]{2,40}$/.test(code)) return Response.json({ ok: false }, { status: 404 });
  const limited = await rateLimit(`supplier-webhook:${code}`, 600, 60);
  if (!limited.allowed) return Response.json({ ok: false }, { status: 429 });

  const supplier = await db.supplier.findUnique({ where: { code }, select: { id: true, code: true, adapterKey: true, config: true, credentialsEncrypted: true, status: true } });
  const secret = supplier ? decodeCredentials(supplier.credentialsEncrypted).webhookSecret : undefined;
  if (!supplier || !secret || supplier.status === "DISABLED") return Response.json({ ok: false }, { status: 404 });

  const raw = await request.text();
  if (raw.length > 1024 * 1024) return Response.json({ ok: false }, { status: 413 });
  if (!verifyWebhookSignature(request.headers.get(SIGNATURE_HEADER), raw, secret)) return Response.json({ ok: false }, { status: 401 });

  const adapter = createAdapter(supplier);
  const event = adapter.parseWebhook ? await adapter.parseWebhook(raw, request.headers) : null;
  if (!event) return Response.json({ ok: false, error: "unsupported event" }, { status: 400 });

  const provider = `supplier:${supplier.code}`;
  try {
    await db.webhookEvent.create({ data: { provider, externalEventId: event.eventId, eventType: event.kind, payload: JSON.parse(raw), signatureValid: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.webhookEvent.findUnique({ where: { provider_externalEventId: { provider, externalEventId: event.eventId } }, select: { status: true } });
      if (existing?.status === "PROCESSED") return Response.json({ ok: true, duplicate: true });
    } else throw error;
  }

  try {
    if (event.kind === "stock") {
      await applyStockUpdates(db, supplier.id, event.updates);
    } else {
      const so = await db.supplierOrder.findFirst({ where: { supplierId: supplier.id, externalOrderId: event.externalOrderId }, select: { id: true, orderId: true, status: true } });
      if (so && event.kind === "tracking") await applyTracking(db, so.id, [event.tracking], { type: "SUPPLIER" });
      if (so && event.kind === "order_status") {
        const mapped = mapExternalStatus(event.status);
        if (mapped) {
          const next = advanceSupplierStatus(so.status as SupplierOrderStatusCode, mapped);
          if (next !== so.status) {
            await db.supplierOrder.update({ where: { id: so.id }, data: { status: next, lastError: next === "REJECTED" ? event.message ?? null : null } });
            await audit({ action: `supplier_order.${next.toLowerCase()}`, actorType: "SUPPLIER", entityType: "SupplierOrder", entityId: so.id });
            await recomputeOrderStatus(db, so.orderId);
          }
        }
      }
    }
    await db.webhookEvent.update({ where: { provider_externalEventId: { provider, externalEventId: event.eventId } }, data: { status: "PROCESSED", processedAt: new Date(), attempts: { increment: 1 } } });
    return Response.json({ ok: true });
  } catch (error) {
    logger.error("supplier_webhook.failed", { supplier: code, error: String(error) });
    await db.webhookEvent.update({ where: { provider_externalEventId: { provider, externalEventId: event.eventId } }, data: { status: "FAILED", error: String(error).slice(0, 1000), attempts: { increment: 1 } } });
    return Response.json({ ok: false }, { status: 500 });
  }
}
