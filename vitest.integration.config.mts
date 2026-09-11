import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ quiet: true });

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL tanımlı olmalı (.env)");

/**
 * Entegrasyon testleri gerçek PostgreSQL'e (ayrı test veritabanı) karşı çalışır.
 * Çalıştırma: npm run test:integration (migration'ı otomatik uygular)
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      PAYMENT_PROVIDER: "mock",
      PAYMENT_WEBHOOK_SECRET: "integration-test-secret",
      QUEUE_INLINE: "1",
      NODE_ENV: "test",
    },
  },
});
