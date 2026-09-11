/**
 * Arka plan worker'ı: `npm run worker`
 *
 * - supplier-sync   : tedarikçi stok/fiyat ve katalog senkronizasyonları
 * - supplier-orders : tedarikçi ataması, sipariş iletimi, kargo sorgulama
 * - maintenance     : zamanlayıcı (her dk), ödeme süresi dolan siparişler,
 *                     kargo takibi, toplu fiyat yeniden hesaplama
 *
 * Web sürecinden bağımsız çalışır ve yatayda ölçeklenebilir (aynı işi iki worker
 * almaz: BullMQ kilidi + SyncJob/SupplierOrder atomik sahiplenme).
 */
import "dotenv/config";
import { Worker } from "bullmq";
import { db } from "../src/server/db";
import { logger } from "../src/server/logger";
import { bullConnection, enqueueOrderJob, enqueueSync, getQueue, QUEUES, type OrderJobData, type SyncJobData } from "../src/server/queue";
import { runSyncJob } from "../src/server/sync/engine";
import { scheduleDueSyncs } from "../src/server/sync/scheduler";
import { handleOrderJob } from "../src/server/orders/jobs";
import { expireUnpaidOrders } from "../src/server/payments/service";
import { recalculateForSupplier } from "../src/server/catalog/recalculate";

const MAX_SYNC_ATTEMPTS = 3;
const connection = bullConnection();

const syncWorker = new Worker<SyncJobData>(
  QUEUES.sync,
  async (job) => {
    const status = await runSyncJob(db, job.data.syncJobId);
    if (status !== "FAILED") return status;
    const j = await db.syncJob.findUnique({ where: { id: job.data.syncJobId }, select: { id: true, supplierId: true, type: true, attempt: true, trigger: true } });
    if (j && j.trigger !== "MANUAL" && j.attempt < MAX_SYNC_ATTEMPTS && (j.type === "STOCK_PRICE" || j.type === "CATALOG")) {
      // Üstel geri çekilme: 2, 4 dk… Tekrar denemeler admin panelinde ayrı iş olarak görünür.
      await enqueueSync(db, j.supplierId, j.type, "RETRY", { retryOfId: j.id, attempt: j.attempt + 1, delayMs: 2 ** j.attempt * 60_000 });
    }
    return status;
  },
  { connection, concurrency: 2 },
);

const orderWorker = new Worker<OrderJobData>(QUEUES.orders, (job) => handleOrderJob(db, job.data), { connection, concurrency: 5 });

const maintenanceWorker = new Worker(
  QUEUES.maintenance,
  async (job) => {
    switch (job.name) {
      case "tick":
        return { queued: await scheduleDueSyncs(db) };
      case "expire-orders":
        return { expired: await expireUnpaidOrders(db, 30) };
      case "poll-tracking": {
        const open = await db.supplierOrder.findMany({
          where: { status: { in: ["SUBMITTED", "ACCEPTED", "SHIPPED"] }, externalOrderId: { not: null }, dispatchMode: "AUTO" },
          select: { id: true },
          take: 1000,
        });
        for (const so of open) await enqueueOrderJob({ kind: "poll", supplierOrderId: so.id });
        return { polled: open.length };
      }
      case "recalc-all":
        return recalculateForSupplier(db);
      default:
        logger.warn("worker.unknown_job", { name: job.name });
    }
  },
  { connection, concurrency: 1 },
);

async function registerSchedulers() {
  const q = getQueue(QUEUES.maintenance);
  await q.upsertJobScheduler("tick", { every: 60_000 }, { name: "tick" });
  await q.upsertJobScheduler("expire-orders", { every: 5 * 60_000 }, { name: "expire-orders" });
  await q.upsertJobScheduler("poll-tracking", { every: 30 * 60_000 }, { name: "poll-tracking" });
}

for (const [name, w] of [["sync", syncWorker], ["orders", orderWorker], ["maintenance", maintenanceWorker]] as const) {
  w.on("failed", (job, err) => logger.error("worker.job_failed", { worker: name, jobId: job?.id, name: job?.name, error: err.message }));
  w.on("error", (err) => logger.error("worker.error", { worker: name, error: err.message }));
}

registerSchedulers()
  .then(() => logger.info("worker.started", { queues: Object.values(QUEUES) }))
  .catch((error) => {
    logger.error("worker.scheduler_failed", { error: String(error) });
    process.exit(1);
  });

async function shutdown(signal: string) {
  logger.info("worker.stopping", { signal });
  await Promise.allSettled([syncWorker.close(), orderWorker.close(), maintenanceWorker.close()]);
  await db.$disconnect();
  await connection.quit();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
