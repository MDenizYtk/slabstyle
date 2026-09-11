import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Veritabanı gerektiren testler ayrı çalışır: npm run test:integration
    exclude: ["tests/integration/**", "node_modules/**"],
    env: {
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
  },
});
