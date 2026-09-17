import { STORE_MODE } from "@/config/mode";
import { db } from "@/server/db";
import { isRedisConfigured, readyRedis } from "@/server/redis";

export const dynamic = "force-dynamic";

/** Yük dengeleyici / uptime izleme için sağlık kontrolü. Gizli bilgi döndürmez. */
export async function GET() {
  const check = async (fn: () => Promise<unknown>) => {
    try {
      await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000))]);
      return true;
    } catch {
      return false;
    }
  };
  const [database, redis] = await Promise.all([
    check(() => db.$queryRaw`SELECT 1`),
    isRedisConfigured() ? check(async () => (await readyRedis(1500)).ping()) : Promise.resolve(null),
  ]);
  const ok = database && redis !== false;
  return Response.json(
    { ok, mode: STORE_MODE, database, redis, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
