import { isIP } from "node:net";
import { logger } from "../logger";

/**
 * Tedarikçi API/feed çağrıları için ortak HTTP istemcisi: zaman aşımı, 429/5xx
 * için üstel geri çekilmeli tekrar, yanıt boyutu sınırı ve SSRF koruması.
 */

export class SupplierHttpError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
  }
}

export type HttpRequest = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  maxBytes?: number;
};

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./];

export function assertSafeUrl(raw: string, allowPrivate = process.env.NODE_ENV !== "production" || process.env.ALLOW_PRIVATE_SUPPLIER_HOSTS === "1") {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SupplierHttpError(`Geçersiz URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SupplierHttpError("Yalnızca http/https desteklenir");
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new SupplierHttpError("Yerel adreslere istek engellendi");
  if (isIP(host) === 4 && PRIVATE_V4.some((r) => r.test(host))) throw new SupplierHttpError("Özel IP adresine istek engellendi");
  if (isIP(host) === 6 && (host === "::1" || /^f[cd]/i.test(host) || /^fe80/i.test(host))) throw new SupplierHttpError("Özel IP adresine istek engellendi");
  return url;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new SupplierHttpError(`Yanıt çok büyük (${declared} bayt)`);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SupplierHttpError(`Yanıt boyut sınırını aştı (${maxBytes} bayt)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function supplierFetch(req: HttpRequest): Promise<{ status: number; text: string; headers: Headers }> {
  const url = assertSafeUrl(req.url);
  const retries = req.retries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: req.method ?? "GET",
        headers: { "user-agent": "SLABSTYLE-Integrations/1.0", ...req.headers },
        body: req.body,
        signal: AbortSignal.timeout(req.timeoutMs ?? 30_000),
        redirect: "follow",
      });
      if (res.status === 429 || res.status >= 500) {
        throw new SupplierHttpError(`Tedarikçi HTTP ${res.status}`, res.status, true);
      }
      const text = await readLimited(res, req.maxBytes ?? 200 * 1024 * 1024);
      if (!res.ok) throw new SupplierHttpError(`Tedarikçi HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, false);
      return { status: res.status, text, headers: res.headers };
    } catch (error) {
      lastError = error;
      const retryable =
        (error instanceof SupplierHttpError && error.retryable) ||
        (error instanceof Error && (error.name === "TimeoutError" || error.name === "TypeError"));
      if (!retryable || attempt === retries) break;
      const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      logger.warn("supplier.http_retry", { host: url.host, attempt: attempt + 1, delay, error: String(error) });
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new SupplierHttpError(String(lastError));
}
