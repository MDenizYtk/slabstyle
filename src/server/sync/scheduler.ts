import { isDue } from "@/domain/sync/guards";
import type { DbClient } from "../db";
import { logger } from "../logger";
import { enqueueSync } from "../queue";

/**
 * Zamanı gelen senkronizasyonları kuyruğa ekler (worker her dakika çağırır).
 * Başarısız bir işten sonra tedarikçi her dakika tekrar denenmesin diye son iş
 * zamanı da hesaba katılır; tekrar denemeler worker'daki geri çekilme ile yapılır.
 */
export async function scheduleDueSyncs(db: DbClient, now = new Date()): Promise<number> {
  const suppliers = await db.supplier.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, code: true, lastStockSyncAt: true, lastCatalogSyncAt: true, stockSyncIntervalMin: true, catalogSyncIntervalMin: true },
  });
  let queued = 0;
  for (const s of suppliers) {
    for (const [type, lastSync, interval] of [
      ["STOCK_PRICE", s.lastStockSyncAt, s.stockSyncIntervalMin],
      ["CATALOG", s.lastCatalogSyncAt, s.catalogSyncIntervalMin],
    ] as const) {
      const lastJob = await db.syncJob.findFirst({ where: { supplierId: s.id, type }, orderBy: { queuedAt: "desc" }, select: { queuedAt: true } });
      const reference = [lastSync, lastJob?.queuedAt].filter((d): d is Date => d != null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      if (!isDue(reference, interval, now)) continue;
      try {
        const { deduped } = await enqueueSync(db, s.id, type, "SCHEDULED");
        if (!deduped) queued++;
      } catch (error) {
        logger.error("scheduler.enqueue_failed", { supplier: s.code, type, error: String(error) });
      }
    }
  }
  return queued;
}
