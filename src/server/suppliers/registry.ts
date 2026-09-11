import type { Prisma } from "@/generated/prisma/client";
import { decryptSecret } from "../security/crypto";
import { FeedSupplierAdapter, feedConfigSchema } from "./adapters/feed";
import { MockSupplierAdapter, mockConfigSchema } from "./adapters/mock";
import { ManualSupplierAdapter, manualConfigSchema } from "./adapters/manual";
import { PortalSupplierAdapter, portalConfigSchema } from "./adapters/portal";
import { RestSupplierAdapter, restConfigSchema } from "./adapters/rest";
import { AdapterConfigError, type SupplierAdapter } from "./types";
import type { z } from "zod";

/**
 * Adapter kayıt defteri. Supplier.adapterKey → adapter fabrikası.
 *
 * Yeni bir tedarikçi eklemek:
 *  - Feed/REST ile config yeterliyse: yalnızca admin panelinden tedarikçi eklenir.
 *  - Özel bir API ise: adapters/<tedarikci>.ts yazılır ve aşağıya tek satır eklenir.
 */

export type AdapterContext = {
  supplier: { id: string; code: string; config: Prisma.JsonValue };
  /** Şifresi çözülmüş kimlik bilgileri. Asla log'lanmaz, istemciye gönderilmez. */
  credentials: Record<string, string>;
  /** Testlerde zamanı sabitlemek için. */
  now?: number;
};

type AdapterDefinition = {
  label: string;
  description: string;
  configSchema: z.ZodType;
  /** Admin formunda gösterilecek kimlik bilgisi alanları. */
  credentialFields: string[];
  create: (ctx: AdapterContext) => SupplierAdapter;
};

export const ADAPTERS: Record<string, AdapterDefinition> = {
  mock: {
    label: "MOCK (test verisi)",
    description: "Gerçek bağlantı yapmaz. Geliştirme ve demo içindir.",
    configSchema: mockConfigSchema,
    credentialFields: [],
    create: (ctx) => new MockSupplierAdapter(ctx),
  },
  manual: {
    label: "Manuel / kendi stoğum",
    description: "Bağlantı yok. Ürün, maliyet ve stok admin panelinden veya dosyayla girilir; siparişler elle hazırlanır.",
    configSchema: manualConfigSchema,
    credentialFields: [],
    create: (ctx) => new ManualSupplierAdapter(ctx),
  },
  "b2b-portal": {
    label: "B2B bayi paneli (web sitesi, API yok)",
    description: "Bayi paneline kullanıcı adı/şifre ile giriş yapıp ürün, fiyat ve stok bilgisini sayfalardan veya dışa aktarım dosyasından okur.",
    configSchema: portalConfigSchema,
    credentialFields: ["username", "password"],
    create: (ctx) => new PortalSupplierAdapter(ctx),
  },
  "generic-feed": {
    label: "XML / CSV / JSON feed",
    description: "Tedarikçinin yayınladığı ürün dosyasını URL'den okur. Siparişler manuel iletilir.",
    configSchema: feedConfigSchema,
    credentialFields: ["username", "password", "token"],
    create: (ctx) => new FeedSupplierAdapter(ctx),
  },
  "generic-rest": {
    label: "REST API (genel)",
    description: "Sayfalı JSON API. Sipariş/kargo uç noktaları config ile tanımlanırsa otomatik sipariş gönderir.",
    configSchema: restConfigSchema,
    credentialFields: ["token", "username", "password"],
    create: (ctx) => new RestSupplierAdapter(ctx),
  },
  // Gerçek tedarikçiye özel adapter'lar buraya eklenecek, örn:
  // "acme-api": { ..., create: (ctx) => new AcmeAdapter(ctx) },
};

export function listAdapters() {
  return Object.entries(ADAPTERS).map(([key, def]) => ({ key, label: def.label, description: def.description, credentialFields: def.credentialFields }));
}

export function decodeCredentials(encrypted: string | null): Record<string, string> {
  if (!encrypted) return {};
  const parsed: unknown = JSON.parse(decryptSecret(encrypted));
  if (!parsed || typeof parsed !== "object") return {};
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
}

export function validateAdapterConfig(adapterKey: string, config: unknown): { ok: true } | { ok: false; message: string } {
  const def = ADAPTERS[adapterKey];
  if (!def) return { ok: false, message: `Bilinmeyen adapter: ${adapterKey}` };
  const res = def.configSchema.safeParse(config);
  return res.success ? { ok: true } : { ok: false, message: res.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ") };
}

export function createAdapter(supplier: { id: string; code: string; adapterKey: string; config: Prisma.JsonValue; credentialsEncrypted: string | null }): SupplierAdapter {
  const def = ADAPTERS[supplier.adapterKey];
  if (!def) throw new AdapterConfigError(`Bilinmeyen adapter: ${supplier.adapterKey}`);
  return def.create({
    supplier: { id: supplier.id, code: supplier.code, config: supplier.config },
    credentials: decodeCredentials(supplier.credentialsEncrypted),
  });
}
