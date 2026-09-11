import { readyRedis } from "./redis";
import { logger } from "./logger";

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

const memory = new Map<string, { count: number; resetAt: number }>();

function memoryHit(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  entry.count += 1;
  const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), retryAfterSec };
}

/**
 * Sabit pencereli rate limit. Redis yoksa süreç içi belleğe düşer; tek sunucuda
 * koruma sürer, çok sunuculu kurulumda Redis gereklidir.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  try {
    const redis = await readyRedis();
    const results = await redis.multi().incr(redisKey).expire(redisKey, windowSec, "NX").ttl(redisKey).exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const ttl = Number(results?.[2]?.[1] ?? windowSec);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec: count > limit ? ttl : 0 };
  } catch (error) {
    logger.warn("rate-limit.redis_unavailable", { error: String(error) });
    return memoryHit(redisKey, limit, windowSec);
  }
}
