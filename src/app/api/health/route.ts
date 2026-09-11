import { db } from "@/server/db";
import { readyRedis } from "@/server/redis";

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
    check(async () => (await readyRedis(1500)).ping()),
  ]);
  const ok = database && redis;
  return Response.json({ ok, database, redis, time: new Date().toISOString() }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
