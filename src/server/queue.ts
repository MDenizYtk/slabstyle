import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import type { SyncJobType, SyncTrigger } from "@/generated/prisma/client";
import type { DbClient } from "./db";
import { logger } from "./logger";

/**
 * Arka plan kuyrukları (BullMQ + Redis). İşleri `npm run worker` süreci çalıştırır;
 * web süreci yalnızca kuyruğa ekler. Böylece uzun senkronizasyonlar HTTP
 * isteklerini bloklamaz ve worker ayrı ölçeklenebilir.
 */

export const QUEUES = {
  sync: "supplier-sync",
  orders: "supplier-orders",
  maintenance: "maintenance",
} as const;

export type SyncJobData = { syncJobId: string };
export type OrderJobData = { kind: "allocate"; orderId: string } | { kind: "submit"; supplierOrderId: string } | { kind: "poll"; supplierOrderId: string };

const g = globalThis as unknown as { bullConnection?: Redis; queues?: Map<string, Queue> };

export function bullConnection(): Redis {
  // BullMQ, bloklayan komutlar için maxRetriesPerRequest: null ister.
  g.bullConnection ??= new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { maxRetriesPerRequest: null });
  return g.bullConnection;
}

export function getQueue(name: string): Queue {
  g.queues ??= new Map();
  let q = g.queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: bullConnection(), defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } });
    g.queues.set(name, q);
  }
  return q;
}

export class QueueUnavailableError extends Error {}

async function withTimeout<T>(p: Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new QueueUnavailableError("Kuyruk (Redis) yanıt vermiyor")), ms))]);
}

/**
 * Senkronizasyon işi oluşturur. Aynı tedarikçi ve türde bekleyen/çalışan iş
 * varsa yenisi açılmaz (çakışan senkronizasyonları önler).
 */
export async function enqueueSync(
  db: DbClient,
  supplierId: string,
  type: Extract<SyncJobType, "STOCK_PRICE" | "CATALOG">,
  trigger: SyncTrigger,
  options: { retryOfId?: string; attempt?: number; delayMs?: number } = {},
): Promise<{ jobId: string; deduped: boolean }> {
  const active = await db.syncJob.findFirst({
    where: { supplierId, type, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true, status: true, queuedAt: true },
  });
  // 1 saatten eski "takılı" işler yeni işi engellemesin.
  if (active && Date.now() - active.queuedAt.getTime() < 60 * 60 * 1000) return { jobId: active.id, deduped: true };
  if (active) await db.syncJob.update({ where: { id: active.id }, data: { status: "FAILED", errorMessage: "Zaman aşımı: iş 1 saatten uzun sürdü", finishedAt: new Date() } });

  const job = await db.syncJob.create({
    data: { supplierId, type, trigger, retryOfId: options.retryOfId, attempt: options.attempt ?? 1 },
    select: { id: true },
  });
  const opts: JobsOptions = { jobId: job.id, attempts: 1, delay: options.delayMs };
  try {
    await withTimeout(getQueue(QUEUES.sync).add("sync", { syncJobId: job.id } satisfies SyncJobData, opts));
  } catch (error) {
    await db.syncJob.update({ where: { id: job.id }, data: { status: "FAILED", errorMessage: `Kuyruğa eklenemedi: ${String(error)}`, finishedAt: new Date() } });
    logger.error("queue.enqueue_failed", { queue: QUEUES.sync, error: String(error) });
    throw new QueueUnavailableError("Kuyruk servisine (Redis) ulaşılamadı");
  }
  return { jobId: job.id, deduped: false };
}

export async function enqueueOrderJob(data: OrderJobData, opts: JobsOptions = {}): Promise<void> {
  const jobId =
    data.kind === "allocate" ? `allocate:${data.orderId}` : data.kind === "submit" ? `submit:${data.supplierOrderId}:${Date.now()}` : `poll:${data.supplierOrderId}:${Date.now()}`;
  await withTimeout(
    getQueue(QUEUES.orders).add(data.kind, data, {
      jobId,
      attempts: data.kind === "submit" ? 5 : 3,
      backoff: { type: "exponential", delay: 30_000 },
      ...opts,
    }),
  );
}
