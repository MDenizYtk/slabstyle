type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = process.env.NODE_ENV === "production" ? "info" : "debug";

// Loglara asla sızmaması gereken alanlar.
const REDACT = /pass(word)?|secret|token|authorization|api[-_]?key|credential|cookie/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT.test(k) ? "[REDACTED]" : redact(v, depth + 1)]),
  );
}

function write(level: Level, event: string, context?: Record<string, unknown>) {
  if (order[level] < order[minLevel] || process.env.VITEST) return;
  // Yapılandırılmış JSON log: üretimde log toplayıcıya (Loki, Datadog vb.) doğrudan akar.
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(context) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, ctx?: Record<string, unknown>) => write("debug", event, ctx),
  info: (event: string, ctx?: Record<string, unknown>) => write("info", event, ctx),
  warn: (event: string, ctx?: Record<string, unknown>) => write("warn", event, ctx),
  error: (event: string, ctx?: Record<string, unknown>) => write("error", event, ctx),
};

export { redact };
