import { Prisma, type SyncJobStatus } from "@/generated/prisma/client";
import { decideRemoval, isSuspiciousPriceChange } from "@/domain/sync/guards";
import type { DbClient } from "../db";
import { logger } from "../logger";
import { sha256Hex } from "../security/crypto";
import { recalculateVariants } from "../catalog/recalculate";
import { matchSupplierProduct } from "../matching/service";
import { createAdapter } from "../suppliers/registry";
import type { NormalizedProduct, RowError, StockPriceUpdate, SupplierAdapter } from "../suppliers/types";

/**
 * Senkronizasyon motoru. Her iş bir SyncJob satırına karşılık gelir ve admin
 * panelinde görünür. İlkeler:
 *  - Hatalı satırlar atlanır, iş PARTIAL biter; doğru veriler yazılmaya devam eder.
 *  - Adapter tamamen hata verirse iş FAILED olur ve mevcut veri SİLİNMEZ.
 *  - Kaldırma ve ani fiyat değişimi güvenlik kurallarından geçer.
 */

export type SyncStats = {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  unknown: number;
  failed: number;
  matched: number;
  review: number;
};

const emptyStats = (): SyncStats => ({ fetched: 0, created: 0, updated: 0, unchanged: 0, removed: 0, unknown: 0, failed: 0, matched: 0, review: 0 });
const MAX_STORED_ERRORS = 100;

type Ctx = {
  db: DbClient;
  supplierId: string;
  stats: SyncStats;
  errors: RowError[];
  touchedVariants: Set<string>;
};

function pushErrors(ctx: Ctx, errors: RowError[]) {
  ctx.stats.failed += errors.length;
  for (const e of errors) if (ctx.errors.length < MAX_STORED_ERRORS) ctx.errors.push(e);
}

export function contentHash(p: NormalizedProduct): string {
  const { raw: _raw, ...rest } = p;
  return sha256Hex(JSON.stringify(rest, Object.keys(rest).sort()));
}

// ─────────────────────────────────────────────────────────── stok / fiyat ──

export async function applyStockBatch(ctx: Ctx, updates: StockPriceUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  ctx.stats.fetched += updates.length;
  const existing = await ctx.db.supplierProduct.findMany({
    where: { supplierId: ctx.supplierId, supplierSku: { in: updates.map((u) => u.supplierSku) } },
    select: { id: true, supplierSku: true, stock: true, costPrice: true, status: true, variantId: true },
  });
  const bySku = new Map(existing.map((e) => [e.supplierSku, e]));
  const rows: Prisma.Sql[] = [];

  for (const u of updates) {
    const cur = bySku.get(u.supplierSku);
    if (!cur) {
      ctx.stats.unknown++;
      continue;
    }
    let cost = u.costPrice ?? cur.costPrice;
    if (u.costPrice != null && isSuspiciousPriceChange(cur.costPrice, u.costPrice)) {
      pushErrors(ctx, [{ row: u.supplierSku, message: `Şüpheli fiyat değişimi (${cur.costPrice} → ${u.costPrice} kuruş) uygulanmadı` }]);
      cost = cur.costPrice;
    }
    const stock = u.stock ?? cur.stock;
    const status = u.isActive === false ? "UNAVAILABLE" : cur.status === "REMOVED" || u.isActive === true ? "ACTIVE" : cur.status;

    if (stock === cur.stock && cost === cur.costPrice && status === cur.status) {
      ctx.stats.unchanged++;
      continue;
    }
    ctx.stats.updated++;
    if (cur.variantId) ctx.touchedVariants.add(cur.variantId);
    rows.push(Prisma.sql`(${cur.id}, ${stock}::int, ${cost}::int, ${status}::"SupplierProductStatus")`);
  }

  // Tek sorguda toplu güncelleme: yüz binlerce üründe satır satır UPDATE'ten çok daha hızlı.
  for (let i = 0; i < rows.length; i += 1000) {
    await ctx.db.$executeRaw`
      UPDATE "SupplierProduct" sp
      SET stock = v.stock, "costPrice" = v.cost, status = v.status,
          "lastStockSyncAt" = now(), "lastPriceSyncAt" = now(), "updatedAt" = now()
      FROM (VALUES ${Prisma.join(rows.slice(i, i + 1000))}) AS v(id, stock, cost, status)
      WHERE sp.id = v.id`;
  }
  await ctx.db.supplierProduct.updateMany({
    where: { supplierId: ctx.supplierId, supplierSku: { in: updates.map((u) => u.supplierSku) } },
    data: { lastStockSyncAt: new Date() },
  });
}

// ─────────────────────────────────────────────────────────────── katalog ──

export async function applyCatalogBatch(ctx: Ctx, items: NormalizedProduct[], seenAt: Date): Promise<void> {
  if (items.length === 0) return;
  ctx.stats.fetched += items.length;
  const existing = await ctx.db.supplierProduct.findMany({
    where: { supplierId: ctx.supplierId, supplierSku: { in: items.map((i) => i.supplierSku) } },
    select: { id: true, supplierSku: true, contentHash: true, costPrice: true, variantId: true, gtin: true, mpn: true, matchStatus: true },
  });
  const bySku = new Map(existing.map((e) => [e.supplierSku, e]));
  const unchangedIds: string[] = [];
  const toMatch: string[] = [];

  for (const p of items) {
    const hash = contentHash(p);
    const cur = bySku.get(p.supplierSku);
    const status = p.isActive === false ? "UNAVAILABLE" : "ACTIVE";

    if (cur && cur.contentHash === hash) {
      unchangedIds.push(cur.id);
      ctx.stats.unchanged++;
      continue;
    }

    let costPrice = p.costPrice;
    if (cur && isSuspiciousPriceChange(cur.costPrice, p.costPrice)) {
      pushErrors(ctx, [{ row: p.supplierSku, message: `Şüpheli fiyat değişimi (${cur.costPrice} → ${p.costPrice} kuruş) uygulanmadı` }]);
      costPrice = cur.costPrice;
    }

    const data = {
      title: p.title,
      description: p.description ?? null,
      brandName: p.brand ?? null,
      gtin: p.gtin ?? null,
      mpn: p.mpn ?? null,
      categoryPath: p.categoryPath ?? null,
      imageUrls: p.imageUrls ?? [],
      attributes: (p.attributes ?? {}) as Prisma.InputJsonValue,
      rawData: (p.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      costPrice,
      currency: p.currency ?? "TRY",
      stock: p.stock,
      leadTimeDays: p.leadTimeDays ?? null,
      status,
      contentHash: hash,
      lastSeenAt: seenAt,
      lastStockSyncAt: seenAt,
      lastPriceSyncAt: seenAt,
    } as const;

    try {
      if (cur) {
        await ctx.db.supplierProduct.update({ where: { id: cur.id }, data });
        ctx.stats.updated++;
        if (cur.variantId) ctx.touchedVariants.add(cur.variantId);
        // Kimlik bilgileri değiştiyse ve eşleşme elle yapılmadıysa yeniden eşleştir.
        const identityChanged = cur.gtin !== data.gtin || cur.mpn !== data.mpn;
        if (cur.matchStatus === "UNMATCHED" || (identityChanged && cur.matchStatus !== "MANUAL_MATCHED")) toMatch.push(cur.id);
      } else {
        const created = await ctx.db.supplierProduct.create({ data: { ...data, supplierId: ctx.supplierId, supplierSku: p.supplierSku }, select: { id: true } });
        ctx.stats.created++;
        toMatch.push(created.id);
      }
    } catch (error) {
      pushErrors(ctx, [{ row: p.supplierSku, message: `Kayıt yazılamadı: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}` }]);
    }
  }

  if (unchangedIds.length) {
    await ctx.db.supplierProduct.updateMany({ where: { id: { in: unchangedIds } }, data: { lastSeenAt: seenAt } });
  }

  for (const id of toMatch) {
    const outcome = await matchSupplierProduct(ctx.db, id);
    if (outcome?.decision.kind === "AUTO") {
      ctx.stats.matched++;
      ctx.touchedVariants.add(outcome.decision.variantId);
    } else if (outcome?.decision.kind === "REVIEW") ctx.stats.review++;
  }
}

async function applyRemovals(ctx: Ctx, runStartedAt: Date): Promise<void> {
  const where = { supplierId: ctx.supplierId, status: { not: "REMOVED" as const }, lastSeenAt: { lt: runStartedAt } };
  const [totalActive, missing] = await Promise.all([
    ctx.db.supplierProduct.count({ where: { supplierId: ctx.supplierId, status: { not: "REMOVED" } } }),
    ctx.db.supplierProduct.findMany({ where, select: { id: true, variantId: true } }),
  ]);
  const decision = decideRemoval(totalActive, missing.length, ctx.stats.fetched);
  if (!decision.apply) {
    pushErrors(ctx, [{ row: "katalog", message: decision.reason }]);
    return;
  }
  if (missing.length === 0) return;
  await ctx.db.supplierProduct.updateMany({ where: { id: { in: missing.map((m) => m.id) } }, data: { status: "REMOVED", stock: 0 } });
  ctx.stats.removed += missing.length;
  for (const m of missing) if (m.variantId) ctx.touchedVariants.add(m.variantId);
}

// ────────────────────────────────────────────────────────────── çalıştır ──

export type RunOptions = { adapterFactory?: (supplier: Parameters<typeof createAdapter>[0]) => SupplierAdapter };

export async function runSyncJob(db: DbClient, jobId: string, options: RunOptions = {}): Promise<SyncJobStatus | null> {
  // Atomik sahiplenme: aynı iş iki worker tarafından çalıştırılamaz.
  const claimed = await db.syncJob.updateMany({ where: { id: jobId, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
  if (claimed.count === 0) return null;

  const job = await db.syncJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { id: true, type: true, startedAt: true, supplier: { select: { id: true, code: true, name: true, adapterKey: true, config: true, credentialsEncrypted: true, status: true } } },
  });
  const ctx: Ctx = { db, supplierId: job.supplier.id, stats: emptyStats(), errors: [], touchedVariants: new Set() };
  const startedAt = job.startedAt ?? new Date();
  logger.info("sync.started", { jobId, supplier: job.supplier.code, type: job.type });

  let status: SyncJobStatus;
  let errorMessage: string | null = null;

  try {
    if (job.supplier.status === "DISABLED") throw new Error("Tedarikçi devre dışı");
    const adapter = (options.adapterFactory ?? createAdapter)(job.supplier);

    if (job.type === "STOCK_PRICE") {
      for await (const batch of adapter.fetchStockAndPrices()) {
        pushErrors(ctx, batch.errors);
        await applyStockBatch(ctx, batch.items);
      }
    } else if (job.type === "CATALOG") {
      let completed = false;
      for await (const batch of adapter.fetchProducts()) {
        pushErrors(ctx, batch.errors);
        await applyCatalogBatch(ctx, batch.items, startedAt);
      }
      completed = true;
      if (completed) await applyRemovals(ctx, startedAt);
    } else {
      throw new Error(`Bu iş türü sync motorunda çalıştırılmaz: ${job.type}`);
    }

    status = ctx.errors.length > 0 ? "PARTIAL" : "SUCCEEDED";
  } catch (error) {
    status = "FAILED";
    errorMessage = error instanceof Error ? error.message.slice(0, 1000) : String(error);
    logger.error("sync.failed", { jobId, supplier: job.supplier.code, error: errorMessage });
  }

  // Başarısız işte bile o ana kadar yazılmış doğru verinin fiyatı/stoku güncel kalsın.
  if (ctx.touchedVariants.size) {
    try {
      await recalculateVariants(db, [...ctx.touchedVariants]);
    } catch (error) {
      logger.error("sync.recalc_failed", { jobId, error: String(error) });
    }
  }

  const finishedAt = new Date();
  await db.syncJob.update({
    where: { id: jobId },
    data: {
      status,
      finishedAt,
      stats: ctx.stats,
      errorMessage: errorMessage ?? (ctx.errors.length ? `${ctx.stats.failed} satır işlenemedi` : null),
      errorDetails: ctx.errors.length ? (ctx.errors as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
  if (status !== "FAILED") {
    await db.supplier.update({
      where: { id: job.supplier.id },
      data: job.type === "CATALOG" ? { lastCatalogSyncAt: finishedAt, lastStockSyncAt: finishedAt } : { lastStockSyncAt: finishedAt },
    });
  }
  await db.auditLog.create({
    data: {
      actorType: "SYSTEM",
      action: `sync.${job.type.toLowerCase()}.${status.toLowerCase()}`,
      entityType: "SyncJob",
      entityId: jobId,
      metadata: { supplier: job.supplier.code, ...ctx.stats },
    },
  });
  logger.info("sync.finished", { jobId, supplier: job.supplier.code, status, ...ctx.stats });
  return status;
}

/** Webhook ile gelen anlık stok/fiyat güncellemeleri (iş kaydı açmadan). */
export async function applyStockUpdates(db: DbClient, supplierId: string, updates: StockPriceUpdate[]) {
  const ctx: Ctx = { db, supplierId, stats: emptyStats(), errors: [], touchedVariants: new Set() };
  await applyStockBatch(ctx, updates);
  if (ctx.touchedVariants.size) await recalculateVariants(db, [...ctx.touchedVariants]);
  return { stats: ctx.stats, errors: ctx.errors };
}

/**
 * Manuel dosya içe aktarımı (CSV/Excel). Aynı katalog hattını kullanır; dosyada
 * olmayanlar yalnızca açıkça istenirse kaldırılır.
 */
export async function runManualImport(
  db: DbClient,
  supplierId: string,
  items: NormalizedProduct[],
  parseErrors: RowError[],
  options: { removeMissing: boolean; actorId?: string },
) {
  const startedAt = new Date();
  const job = await db.syncJob.create({
    data: { supplierId, type: "MANUAL_IMPORT", status: "RUNNING", trigger: "MANUAL", startedAt },
    select: { id: true },
  });
  const ctx: Ctx = { db, supplierId, stats: emptyStats(), errors: [], touchedVariants: new Set() };
  pushErrors(ctx, parseErrors);
  let status: SyncJobStatus = "SUCCEEDED";
  let errorMessage: string | null = null;
  try {
    for (let i = 0; i < items.length; i += 500) await applyCatalogBatch(ctx, items.slice(i, i + 500), startedAt);
    if (options.removeMissing) await applyRemovals(ctx, startedAt);
    if (ctx.errors.length) status = "PARTIAL";
  } catch (error) {
    status = "FAILED";
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  if (ctx.touchedVariants.size) await recalculateVariants(db, [...ctx.touchedVariants]);
  await db.syncJob.update({
    where: { id: job.id },
    data: {
      status,
      finishedAt: new Date(),
      stats: ctx.stats,
      errorMessage: errorMessage ?? (ctx.errors.length ? `${ctx.stats.failed} satır işlenemedi` : null),
      errorDetails: ctx.errors.length ? (ctx.errors as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
  await db.auditLog.create({
    data: { actorType: "USER", actorId: options.actorId ?? null, action: "product.import", entityType: "SyncJob", entityId: job.id, metadata: { ...ctx.stats } },
  });
  return { jobId: job.id, status, stats: ctx.stats, errors: ctx.errors };
}
