/**
 * Canlı ortam ilk kurulumu — MOCK VERİ İÇERMEZ.
 * Her deploy'da migration'dan sonra çalışır ve idempotent'tir:
 *  - Hiç ADMIN yoksa SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD ile admin oluşturur
 *    (varsa dokunmaz; şifre sonradan env değişince SIFIRLANMAZ).
 *  - Fiyat ve kargo ayarları yoksa varsayılanları yazar.
 *  - Hiç fiyat kuralı yoksa kademeli marj kurallarını ekler.
 *  - Hiç kategori yoksa varsayılan kategori yapısını ekler.
 *  - "Kendi Stoğum" içsel tedarikçisini oluşturur.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import { SETTING_KEYS } from "../src/server/settings";
import { ensureOwnStockSupplier } from "../src/server/catalog/own-stock";
import { DEFAULT_PRICING_SETTINGS } from "../src/domain/pricing/engine";
import { DEFAULT_SHIPPING_SETTINGS } from "../src/domain/shipping/methods";
import { DEFAULT_CATEGORIES, DEFAULT_PRICING_TIERS } from "../src/content/categories";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");

async function main() {
  const log: string[] = [];

  if ((await db.user.count({ where: { role: "ADMIN" } })) === 0) {
    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD ?? "";
    if (!email || password.length < 12) {
      throw new Error("İlk admin için SEED_ADMIN_EMAIL ve en az 12 karakterlik SEED_ADMIN_PASSWORD gerekli");
    }
    await db.user.create({ data: { email, name: "SLAB STYLE Admin", role: "ADMIN", passwordHash: await hashPassword(password) } });
    log.push(`admin oluşturuldu: ${email}`);
  }

  for (const [key, value] of [
    [SETTING_KEYS.pricing, DEFAULT_PRICING_SETTINGS],
    [SETTING_KEYS.shipping, DEFAULT_SHIPPING_SETTINGS],
  ] as const) {
    const exists = await db.setting.findUnique({ where: { key } });
    if (!exists) {
      await db.setting.create({ data: { key, value } });
      log.push(`ayar: ${key}`);
    }
  }

  if ((await db.pricingRule.count()) === 0) {
    for (const t of DEFAULT_PRICING_TIERS) await db.pricingRule.create({ data: { ...t, scope: "GLOBAL" } });
    log.push("kademeli fiyat kuralları eklendi");
  }

  if ((await db.category.count()) === 0) {
    const ids = new Map<string, string>();
    for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
      const row = await db.category.create({
        data: { slug: c.slug, name: c.name, description: c.description, position: i, parentId: c.parent ? ids.get(c.parent) : null },
      });
      ids.set(c.slug, row.id);
    }
    log.push(`${DEFAULT_CATEGORIES.length} kategori eklendi`);
  }

  await ensureOwnStockSupplier(db);
  console.log(log.length ? `Bootstrap: ${log.join(" · ")}` : "Bootstrap: değişiklik yok (zaten kurulu)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
