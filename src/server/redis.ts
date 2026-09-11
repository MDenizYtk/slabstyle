import { Redis } from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

/**
 * Paylaşılan Redis bağlantısı. Redis erişilemezse çağıranlar hatayı yakalayıp
 * güvenli bir yedek davranışa geçmelidir (ör. bellek içi rate limit).
 */
export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    globalForRedis.redis.on("error", () => {
      // Bağlantı hataları çağıran tarafta ele alınır; burada süreci düşürmemek için yutulur.
    });
  }
  return globalForRedis.redis;
}

/**
 * Bağlantı hazır olana kadar kısa süre bekler. Sunucu yeni açıldığında bağlantı
 * "connecting" durumundayken gelen komutlar (offline kuyruk kapalı olduğu için)
 * hata vermesin diye kullanılır. Süre dolarsa hata fırlatır; çağıran yedeğe geçer.
 */
export async function readyRedis(timeoutMs = 1000): Promise<Redis> {
  const redis = getRedis();
  if (redis.status === "ready") return redis;
  if (redis.status === "wait") void redis.connect().catch(() => undefined);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      redis.off("ready", onReady);
      reject(new Error(`Redis hazır değil (durum: ${redis.status})`));
    }, timeoutMs);
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    redis.once("ready", onReady);
  });
  return redis;
}
