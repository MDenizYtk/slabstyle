import type { DbClient } from "../db";
import { logger } from "../logger";
import { enqueueOrderJob, QueueUnavailableError, type OrderJobData } from "../queue";
import { allocateOrder, pollSupplierOrder, submitSupplierOrder } from "./dispatch";

/** Worker ve inline çalıştırma için ortak iş işleyicisi. */
export async function handleOrderJob(db: DbClient, data: OrderJobData): Promise<void> {
  switch (data.kind) {
    case "allocate": {
      const result = await allocateOrder(db, data.orderId);
      for (const id of result.autoSubmitIds ?? []) await scheduleOrderJob(db, { kind: "submit", supplierOrderId: id });
      return;
    }
    case "submit":
      await submitSupplierOrder(db, data.supplierOrderId);
      return;
    case "poll":
      await pollSupplierOrder(db, data.supplierOrderId);
      return;
  }
}

/**
 * Sipariş işini kuyruğa ekler. QUEUE_INLINE=1 (yerel geliştirme / tek süreç)
 * ise hemen çalıştırır. Üretimde kuyruk yoksa hata yükseltilir; webhook 500
 * döner ve ödeme sağlayıcısı tekrar dener.
 */
export async function scheduleOrderJob(db: DbClient, data: OrderJobData): Promise<void> {
  const inline = process.env.QUEUE_INLINE === "1";
  if (!inline) {
    try {
      await enqueueOrderJob(data);
      return;
    } catch (error) {
      if (process.env.NODE_ENV === "production" || !(error instanceof QueueUnavailableError || error instanceof Error)) throw error;
      logger.warn("orders.inline_fallback", { kind: data.kind, error: String(error) });
    }
  }
  try {
    await handleOrderJob(db, data);
  } catch (error) {
    // Inline modda tedarikçi hatası ödeme akışını bozmaz; durum FAILED yazılmıştır, admin tekrar dener.
    logger.error("orders.inline_job_failed", { kind: data.kind, error: String(error) });
  }
}
