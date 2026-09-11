/**
 * Geliştirme seed'i. Tüm tedarikçi ve ürün verisi MOCK'tur (bkz. src/server/suppliers/mock/fixtures.ts).
 * Idempotent'tir: tekrar çalıştırıldığında kayıtları günceller, çoğaltmaz.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import { recalculateVariants } from "../src/server/catalog/recalculate";
import { SETTING_KEYS } from "../src/server/settings";
import { DEFAULT_PRICING_SETTINGS } from "../src/domain/pricing/engine";
import { DEFAULT_SHIPPING_SETTINGS } from "../src/domain/shipping/methods";
import { slugify } from "../src/lib/utils";
import { MOCK_BRANDS, MOCK_CATEGORIES, MOCK_PRODUCTS, MOCK_SUPPLIERS, mockCatalogFor } from "../src/server/suppliers/mock/fixtures";

const db = createPrismaClient(process.env.DATABASE_URL!);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} tanımlı olmalı (.env)`);
  return v;
}

async function main() {
  console.log("Seed başlıyor (MOCK veri)…");

  // Kullanıcılar
  const adminEmail = required("SEED_ADMIN_EMAIL").toLowerCase();
  await db.user.upsert({
    where: { email: adminEmail },
    create: { email: adminEmail, name: "SLAB Admin", role: "ADMIN", passwordHash: await hashPassword(required("SEED_ADMIN_PASSWORD")) },
    update: { role: "ADMIN" },
  });
  const customer = await db.user.upsert({
    where: { email: "demo@slabstyle.local" },
    create: { email: "demo@slabstyle.local", name: "Demo Müşteri", passwordHash: await hashPassword(required("SEED_CUSTOMER_PASSWORD")) },
    update: {},
  });
  if ((await db.address.count({ where: { userId: customer.id } })) === 0) {
    await db.address.create({
      data: {
        userId: customer.id, title: "Ev", fullName: "Demo Müşteri", phone: "05550000000",
        line1: "Örnek Mah. Deneme Sk. No:1 D:2", district: "Çankaya", city: "Ankara", postalCode: "06000", isDefault: true,
      },
    });
  }

  // Ayarlar ve fiyat kuralları (kullanıcının örneğiyle aynı kademeler)
  await db.setting.upsert({ where: { key: SETTING_KEYS.pricing }, create: { key: SETTING_KEYS.pricing, value: DEFAULT_PRICING_SETTINGS }, update: {} });
  await db.setting.upsert({ where: { key: SETTING_KEYS.shipping }, create: { key: SETTING_KEYS.shipping, value: DEFAULT_SHIPPING_SETTINGS }, update: {} });

  const tiers = [
    { id: "rule-tier-1", name: "Maliyet < 500 TL → %30", minCost: null, maxCost: 50_000, marginBps: 3000 },
    { id: "rule-tier-2", name: "500–1500 TL → %25", minCost: 50_000, maxCost: 150_000, marginBps: 2500 },
    { id: "rule-tier-3", name: "1500 TL üzeri → %20", minCost: 150_000, maxCost: null, marginBps: 2000 },
  ];
  for (const t of tiers) {
    await db.pricingRule.upsert({ where: { id: t.id }, create: { ...t, scope: "GLOBAL" }, update: {} });
  }

  // Katalog
  const categoryIds = new Map<string, string>();
  for (const [i, c] of MOCK_CATEGORIES.entries()) {
    const row = await db.category.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, name: c.name, description: c.description, position: i, parentId: c.parent ? categoryIds.get(c.parent) : null },
      update: { name: c.name, description: c.description, position: i },
    });
    categoryIds.set(c.slug, row.id);
  }

  const brandIds = new Map<string, string>();
  for (const name of MOCK_BRANDS) {
    const row = await db.brand.upsert({ where: { slug: slugify(name) }, create: { slug: slugify(name), name }, update: { name } });
    brandIds.set(name, row.id);
  }

  const variantIds = new Map<string, string>(); // `${productKey}:${index}` → id
  for (const [pi, p] of MOCK_PRODUCTS.entries()) {
    const slug = slugify(p.name);
    const product = await db.product.upsert({
      where: { slug },
      create: {
        slug, name: p.name, shortDesc: p.shortDesc, description: p.description, specs: p.specs,
        brandId: brandIds.get(p.brand), categoryId: categoryIds.get(p.category), status: "ACTIVE",
        isFeatured: p.featured ?? false, publishedAt: new Date(Date.now() - pi * 86_400_000),
      },
      update: { name: p.name, shortDesc: p.shortDesc, description: p.description, specs: p.specs, isFeatured: p.featured ?? false },
    });
    if ((await db.productImage.count({ where: { productId: product.id } })) === 0) {
      await db.productImage.create({ data: { productId: product.id, url: `/images/products/${p.image}.svg`, alt: p.name } });
    }
    for (const [vi, v] of p.variants.entries()) {
      const sku = `SS-${v.mpn}`;
      const variant = await db.productVariant.upsert({
        where: { sku },
        create: { productId: product.id, sku, gtin: v.gtin, mpn: v.mpn, name: v.name, options: v.options, isDefault: vi === 0, position: vi },
        update: { name: v.name, options: v.options, gtin: v.gtin, mpn: v.mpn },
      });
      variantIds.set(`${p.key}:${vi}`, variant.id);
    }
  }

  // MOCK tedarikçiler ve teklifleri
  for (const s of MOCK_SUPPLIERS) {
    const supplier = await db.supplier.upsert({
      where: { code: s.code },
      create: {
        code: s.code, name: s.name, status: "ACTIVE", integrationType: "MOCK", adapterKey: "mock",
        priority: s.priority, safetyStock: s.safetyStock, defaultLeadTimeDays: s.leadTimeDays,
        autoSubmitOrders: s.code !== "mock-c",
        config: { mock: true, dataset: s.code },
        notes: "MOCK tedarikçi — gerçek bir firmayı temsil etmez.",
      },
      update: {},
    });

    for (const offer of mockCatalogFor(s)) {
      const variantId = variantIds.get(`${offer.productKey}:${offer.variantIndex}`) ?? null;
      await db.supplierProduct.upsert({
        where: { supplierId_supplierSku: { supplierId: supplier.id, supplierSku: offer.supplierSku } },
        create: {
          supplierId: supplier.id, supplierSku: offer.supplierSku, variantId, gtin: offer.gtin, mpn: offer.mpn,
          brandName: offer.brandName, title: offer.title, costPrice: offer.costPrice, stock: offer.stock,
          matchStatus: variantId ? "AUTO_MATCHED" : "UNMATCHED", matchMethod: variantId ? "GTIN" : null, matchConfidence: variantId ? 1 : null,
          lastStockSyncAt: new Date(), lastPriceSyncAt: new Date(),
        },
        update: { costPrice: offer.costPrice, stock: offer.stock },
      });
    }
  }

  // Eşleşmemiş örnek: admin eşleştirme ekranında görünmesi için (MOCK)
  const supplierC = await db.supplier.findUniqueOrThrow({ where: { code: "mock-c" } });
  await db.supplierProduct.upsert({
    where: { supplierId_supplierSku: { supplierId: supplierC.id, supplierSku: "C-UNMATCHED-1" } },
    create: {
      supplierId: supplierC.id, supplierSku: "C-UNMATCHED-1", title: "Seramik Sprey Koruma 500ml (Aqua Shield)",
      brandName: "Aqua Shield", costPrice: 33_500, stock: 12, matchStatus: "UNMATCHED",
    },
    update: {},
  });

  const stats = await recalculateVariants(db, [...variantIds.values()]);
  console.log(`Fiyat/stok hesaplandı: ${stats.variants} varyant`);

  // Kampanya örneği: bazı varyantlarda üstü çizili fiyat
  const featuredVariants = await db.price.findMany({ where: { variant: { product: { isFeatured: true } } }, take: 4, orderBy: { amount: "desc" } });
  for (const p of featuredVariants) {
    await db.price.update({ where: { id: p.id }, data: { compareAtAmount: Math.round((p.amount * 1.2) / 100) * 100 } });
  }

  console.log("Seed tamamlandı.");
  console.log(`Admin: ${adminEmail} / (SEED_ADMIN_PASSWORD)`);
  console.log("Müşteri: demo@slabstyle.local / (SEED_CUSTOMER_PASSWORD)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
