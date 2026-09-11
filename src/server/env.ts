import { z } from "zod";

/**
 * Sunucu ortam değişkenleri. Tek doğruluk kaynağı burasıdır; kod içinde doğrudan
 * process.env okumak yerine getEnv() kullanılır. Doğrulama ilk erişimde yapılır
 * ki build aşamasında gereksiz yere hata verilmesin.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:4920"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL tanımlı olmalı"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "ENCRYPTION_KEY 32 baytlık base64 olmalı (openssl rand -base64 32)",
    }),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  PAYMENT_PROVIDER: z.string().default("mock"),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Geçersiz ortam değişkenleri: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => process.env.NODE_ENV === "production";
