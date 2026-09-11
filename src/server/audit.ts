import type { ActorType, Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { logger } from "./logger";

export type AuditEntry = {
  action: string;
  actorType?: ActorType;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
};

/**
 * Önemli işlemleri hem yapılandırılmış log'a hem de AuditLog tablosuna yazar.
 * Denetim kaydı başarısız olsa bile ana işlemi bozmaz.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  logger.info(`audit.${entry.action}`, {
    actorType: entry.actorType ?? "SYSTEM",
    actorId: entry.actorId,
    entityType: entry.entityType,
    entityId: entry.entityId,
  });
  try {
    await db.auditLog.create({
      data: {
        action: entry.action,
        actorType: entry.actorType ?? "SYSTEM",
        actorId: entry.actorId ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
        ip: entry.ip ?? null,
      },
    });
  } catch (error) {
    logger.error("audit.write_failed", { action: entry.action, error: String(error) });
  }
}
