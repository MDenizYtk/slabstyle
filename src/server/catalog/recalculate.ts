import { calculatePrice, type PricingRuleInput } from "@/domain/pricing/engine";
import { aggregateStock } from "@/domain/inventory/stock";
import { selectBestOffer, type SupplierOffer } from "@/domain/sourcing/select-offer";
import type { DbClient } from "../db";
import { getPricingSettings } from "../settings";
import { logger } from "../logger";

export type RecalcStats = { variants: number; priceChanged: number; stockChanged: number };

const CHUNK = 500;

/**
 * Verilen varyantların satış fiyatını ve satılabilir stoğunu tedarikçi
 * tekliflerinden yeniden hesaplar; ardından ürün seviyesindeki denormalize
 * alanları (minPrice, totalAvailable) günceller.
 *
 * Hiç uygun teklif yoksa mevcut fiyat SİLİNMEZ, yalnızca stok 0'a çekilir.
 */
export async function recalculateVariants(db: DbClient, variantIds: readonly string[]): Promise<RecalcStats> {
  const stats: RecalcStats = { variants: 0, priceChanged: 0, stockChanged: 0 };
  if (variantIds.length === 0) return stats;

  const [settings, ruleRows] = await Promise.all([
    getPricingSettings(db),
    db.pricingRule.findMany({ where: { isActive: true } }),
  ]);
  const rules: PricingRuleInput[] = ruleRows;
  const touchedProducts = new Set<string>();

  for (let i = 0; i < variantIds.length; i += CHUNK) {
    const ids = variantIds.slice(i, i + CHUNK);
    const variants = await db.productVariant.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        productId: true,
        isActive: true,
        product: { select: { categoryId: true, brandId: true, status: true } },
        price: { select: { amount: true, manualAmount: true } },
        inventory: { select: { availableQty: true, reservedQty: true } },
        supplierProducts: {
          select: {
            id: true,
            supplierId: true,
            costPrice: true,
            stock: true,
            leadTimeDays: true,
            status: true,
            supplier: { select: { status: true, safetyStock: true, priority: true, defaultLeadTimeDays: true } },
          },
        },
      },
    });

    await db.$transaction(async (tx) => {
      for (const v of variants) {
        stats.variants++;
        touchedProducts.add(v.productId);

        const offers: SupplierOffer[] = v.supplierProducts.map((sp) => ({
          supplierProductId: sp.id,
          supplierId: sp.supplierId,
          cost: sp.costPrice,
          stock: sp.stock,
          safetyStock: sp.supplier.safetyStock,
          leadTimeDays: sp.leadTimeDays ?? sp.supplier.defaultLeadTimeDays,
          supplierPriority: sp.supplier.priority,
          isAvailable: v.isActive && sp.status === "ACTIVE" && sp.supplier.status === "ACTIVE",
        }));

        const aggregated = aggregateStock(offers);
        const { supplierQty } = aggregated;
        // Ödeme bekleyen / henüz tedarikçiye iletilmemiş siparişlerdeki adetler düşülür.
        const availableQty = Math.max(0, aggregated.availableQty - (v.inventory?.reservedQty ?? 0));
        if ((v.inventory?.availableQty ?? -1) !== availableQty) stats.stockChanged++;
        await tx.inventory.upsert({
          where: { variantId: v.id },
          create: { variantId: v.id, availableQty, supplierQty },
          update: { availableQty, supplierQty },
        });

        const best = selectBestOffer(offers);
        if (!best) continue;

        const calc = calculatePrice(
          { cost: best.cost, supplierId: best.supplierId, categoryId: v.product.categoryId, brandId: v.product.brandId },
          rules,
          settings,
        );
        const amount = v.price?.manualAmount ?? calc.amount;
        if (v.price?.amount !== amount) {
          stats.priceChanged++;
          logger.debug("price.updated", { variantId: v.id, from: v.price?.amount ?? null, to: amount });
        }
        await tx.price.upsert({
          where: { variantId: v.id },
          create: {
            variantId: v.id,
            amount,
            supplierProductId: best.supplierProductId,
            costAmount: best.cost,
            pricingRuleId: calc.ruleId,
          },
          update: {
            amount,
            supplierProductId: best.supplierProductId,
            costAmount: best.cost,
            pricingRuleId: calc.ruleId,
            calculatedAt: new Date(),
          },
        });
      }
    });
  }

  await refreshProductAggregates(db, [...touchedProducts]);
  return stats;
}

/** Ürün kartlarında ve sıralamada kullanılan denormalize alanları günceller. */
export async function refreshProductAggregates(db: DbClient, productIds: readonly string[]): Promise<void> {
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const ids = productIds.slice(i, i + CHUNK);
    await db.$executeRaw`
      UPDATE "Product" p SET
        "minPrice" = agg.min_price,
        "totalAvailable" = agg.total_available,
        "searchText" = agg.search_text,
        "searchVector" =
          setweight(to_tsvector('simple', immutable_unaccent(lower(p.name))), 'A') ||
          setweight(to_tsvector('simple', agg.search_text), 'B')
      FROM (
        SELECT v."productId" AS product_id,
               MIN(pr.amount) FILTER (WHERE COALESCE(i."availableQty", 0) > 0) AS min_price_in_stock,
               MIN(pr.amount) AS min_price_any,
               COALESCE(SUM(i."availableQty"), 0)::int AS total_available,
               COALESCE(MIN(pr.amount) FILTER (WHERE COALESCE(i."availableQty", 0) > 0), MIN(pr.amount)) AS min_price,
               immutable_unaccent(lower(concat_ws(' ',
                 MAX(pp.name), MAX(b.name), MAX(c.name),
                 string_agg(DISTINCT v.name, ' '), string_agg(DISTINCT v.sku, ' '),
                 string_agg(DISTINCT v.gtin, ' '), string_agg(DISTINCT v.mpn, ' ')
               ))) AS search_text
        FROM "ProductVariant" v
        JOIN "Product" pp ON pp.id = v."productId"
        LEFT JOIN "Brand" b ON b.id = pp."brandId"
        LEFT JOIN "Category" c ON c.id = pp."categoryId"
        LEFT JOIN "Price" pr ON pr."variantId" = v.id
        LEFT JOIN "Inventory" i ON i."variantId" = v.id
        WHERE v."productId" = ANY(${ids}::text[]) AND v."isActive" = true
        GROUP BY v."productId"
      ) agg
      WHERE p.id = agg.product_id`;
  }
}

/** Bir tedarikçinin (veya tüm) eşleşmiş varyantlarını yeniden hesaplar. */
export async function recalculateForSupplier(db: DbClient, supplierId?: string): Promise<RecalcStats> {
  const rows = await db.supplierProduct.findMany({
    where: { variantId: { not: null }, ...(supplierId ? { supplierId } : {}) },
    select: { variantId: true },
    distinct: ["variantId"],
  });
  return recalculateVariants(
    db,
    rows.map((r) => r.variantId).filter((id): id is string => id !== null),
  );
}
