import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Temel güvenlik başlıkları. Ödeme sağlayıcısı eklendiğinde CSP'ye onun
// alan adları (script/frame) eklenecek.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "bullmq", "ioredis", "exceljs", "playwright", "playwright-core", "sharp"],
  experimental: {
    // Admin manuel ürün içe aktarımı (CSV/Excel) için; dosya boyutu ayrıca action içinde sınırlanır.
    serverActions: { bodySizeLimit: "30mb" },
  },
  images: {
    // Tedarikçi görsel alan adları Aşama 2+'da env üzerinden eklenecek.
    remotePatterns: [],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
