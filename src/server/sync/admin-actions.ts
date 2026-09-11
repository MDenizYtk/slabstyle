"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { requireStaff } from "../auth/dal";
import { enqueueSync, QueueUnavailableError } from "../queue";
import { runSyncJob } from "./engine";
import { logger } from "../logger";

const triggerSchema = z.object({ supplierId: z.string().min(1).max(40), type: z.enum(["STOCK_PRICE", "CATALOG"]) });

/**
 * Redis/worker yoksa (yerel geliştirme) QUEUE_INLINE=1 ile iş istek içinde çalıştırılabilir.
 * Üretimde iş her zaman kuyruğa gider.
 */
async function dispatch(supplierId: string, type: "STOCK_PRICE" | "CATALOG", trigger: "MANUAL" | "RETRY", retryOfId?: string, attempt?: number) {
  try {
    const { jobId, deduped } = await enqueueSync(db, supplierId, type, trigger, { retryOfId, attempt });
    if (!deduped && process.env.QUEUE_INLINE === "1") await runSyncJob(db, jobId);
    return jobId;
  } catch (error) {
    if (error instanceof QueueUnavailableError && process.env.NODE_ENV !== "production") {
      logger.warn("sync.inline_fallback", { supplierId, type });
      const job = await db.syncJob.create({ data: { supplierId, type, trigger, retryOfId, attempt: attempt ?? 1 }, select: { id: true } });
      await runSyncJob(db, job.id);
      return job.id;
    }
    throw error;
  }
}

export async function triggerSyncAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const parsed = triggerSchema.safeParse({ supplierId: formData.get("supplierId"), type: formData.get("type") });
  if (!parsed.success) return;
  const jobId = await dispatch(parsed.data.supplierId, parsed.data.type, "MANUAL");
  await audit({ action: "sync.triggered", actorType: "USER", actorId: user.id, entityType: "SyncJob", entityId: jobId, metadata: parsed.data });
  revalidatePath("/admin/sync");
  revalidatePath(`/admin/suppliers/${parsed.data.supplierId}`);
}

export async function retrySyncJobAction(formData: FormData): Promise<void> {
  const user = await requireStaff();
  const jobId = z.string().min(1).max(40).safeParse(formData.get("jobId"));
  if (!jobId.success) return;
  const job = await db.syncJob.findUnique({ where: { id: jobId.data }, select: { id: true, supplierId: true, type: true, attempt: true, status: true } });
  if (!job || (job.status !== "FAILED" && job.status !== "PARTIAL")) return;
  if (job.type !== "STOCK_PRICE" && job.type !== "CATALOG") return;
  const newId = await dispatch(job.supplierId, job.type, "RETRY", job.id, job.attempt + 1);
  await audit({ action: "sync.retried", actorType: "USER", actorId: user.id, entityType: "SyncJob", entityId: newId, metadata: { retryOf: job.id } });
  revalidatePath("/admin/sync");
}
