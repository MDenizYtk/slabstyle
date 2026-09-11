import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export function createPrismaClient(connectionString: string) {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export type DbClient = ReturnType<typeof createPrismaClient>;

// Geliştirmede hot-reload her seferinde yeni bağlantı havuzu açmasın.
const globalForPrisma = globalThis as unknown as { prisma?: DbClient };

export const db: DbClient =
  globalForPrisma.prisma ?? createPrismaClient(process.env.DATABASE_URL ?? "");

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
