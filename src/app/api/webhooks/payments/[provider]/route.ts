import { db } from "@/server/db";
import { processPaymentWebhook } from "@/server/payments/service";
import { rateLimit } from "@/server/rate-limit";

const MAX_BODY = 1024 * 1024;

/**
 * Ödeme sağlayıcısı webhook'u. Kimlik doğrulama imza iledir (oturum/CSRF yok).
 * Aynı olay tekrar gelirse 200 "duplicate" döner; sipariş iki kez işlenmez.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/payments/[provider]">) {
  const { provider } = await ctx.params;
  if (!/^[a-z0-9-]{1,30}$/.test(provider)) return Response.json({ ok: false }, { status: 404 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = await rateLimit(`webhook:${provider}:${ip}`, 600, 60);
  if (!limited.allowed) return Response.json({ ok: false }, { status: 429 });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ ok: false }, { status: 413 });

  const result = await processPaymentWebhook(db, provider, raw, request.headers);
  return Response.json(result.body, { status: result.status });
}
