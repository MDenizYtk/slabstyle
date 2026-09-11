import type { DbClient } from "../db";

/**
 * "Kendi Stoğum": tedarikçiye bağlı olmayan, elinizde bulunan ürünler için içsel
 * tedarikçi. Böylece elle eklenen ürünler de aynı fiyat/stok/sipariş hattından
 * geçer (stok, maliyet, fiyat kuralı, sipariş dağıtımı).
 */
export const OWN_STOCK_CODE = "own-stock";

export async function ensureOwnStockSupplier(db: DbClient) {
  return db.supplier.upsert({
    where: { code: OWN_STOCK_CODE },
    create: {
      code: OWN_STOCK_CODE,
      name: "Kendi Stoğum",
      status: "ACTIVE",
      integrationType: "MANUAL_IMPORT",
      adapterKey: "manual",
      priority: 50,
      safetyStock: 0,
      defaultLeadTimeDays: 1,
      autoSubmitOrders: false,
      config: {},
      notes: "Admin panelinden elle eklenen ürünlerin stoğu. Siparişler elle hazırlanır.",
    },
    update: {},
    select: { id: true },
  });
}

/** Varyantın kendi stok kaydını (maliyet + adet) oluşturur veya günceller. */
export async function setOwnStock(db: DbClient, variantId: string, input: { cost: number; stock: number }) {
  const supplier = await ensureOwnStockSupplier(db);
  const variant = await db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { sku: true, gtin: true, mpn: true, name: true, product: { select: { name: true, brand: { select: { name: true } } } } },
  });
  const existing = await db.supplierProduct.findFirst({ where: { supplierId: supplier.id, variantId }, select: { id: true } });
  const data = {
    costPrice: input.cost,
    stock: input.stock,
    status: "ACTIVE" as const,
    title: `${variant.product.name} - ${variant.name}`,
    gtin: variant.gtin,
    mpn: variant.mpn,
    brandName: variant.product.brand?.name ?? null,
    lastStockSyncAt: new Date(),
    lastPriceSyncAt: new Date(),
  };
  if (existing) {
    await db.supplierProduct.update({ where: { id: existing.id }, data });
  } else {
    await db.supplierProduct.create({
      data: { ...data, supplierId: supplier.id, supplierSku: variant.sku, variantId, matchStatus: "MANUAL_MATCHED", matchMethod: "MANUAL", matchConfidence: 1 },
    });
  }
}
