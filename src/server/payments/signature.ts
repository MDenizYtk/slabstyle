import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook imzası: `t=<unix saniye>,v1=<HMAC-SHA256(secret, "t.body") hex>`.
 * Zaman damgası tekrar oynatma (replay) saldırılarını sınırlar.
 */

export const SIGNATURE_HEADER = "x-slab-signature";

function hmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmac(secret, `${timestamp}.${body}`)}`;
}

export function verifyWebhookSignature(header: string | null, body: string, secret: string, toleranceSec = 300, nowMs = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(hmac(secret, `${t}.${body}`), "hex");
  const given = Buffer.from(v1, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
