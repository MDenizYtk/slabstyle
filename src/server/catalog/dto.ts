import type { Prisma } from "@/generated/prisma/client";
import { stockLabel, stockLevel, type StockLevel } from "@/domain/inventory/stock";

/**
 * Müşteriye açık veri biçimleri. Bu dosyadaki select'ler bilinçli olarak dar
 * tutulur: tedarikçi adı, tedarikçi SKU'su, alış fiyatı ve ham stok ASLA seçilmez.
 * Mağaza tarafındaki tüm sorgular yalnızca buradaki select ve mapper'ları kullanır.
 */

export const PRODUCT_CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  minPrice: true,
  totalAvailable: true,
  brand: { select: { name: true, slug: true } },
  images: { select: { url: true, alt: true }, orderBy: { position: "asc" }, take: 1 },
  variants: {
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
    take: 1,
    select: { price: { select: { compareAtAmount: true } } },
  },
} satisfies Prisma.ProductSelect;

export type ProductCardRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_CARD_SELECT }>;

export type PublicProductCard = {
  id: string;
  slug: string;
  name: string;
  brand: { name: string; slug: string } | null;
  imageUrl: string | null;
  imageAlt: string;
  price: number | null;
  compareAtPrice: number | null;
  stockLevel: StockLevel;
  stockLabel: string;
};

export function toProductCard(row: ProductCardRow): PublicProductCard {
  const image = row.images[0];
  const compareAt = row.variants[0]?.price?.compareAtAmount ?? null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brand ? { name: row.brand.name, slug: row.brand.slug } : null,
    imageUrl: image?.url ?? null,
    imageAlt: image?.alt ?? row.name,
    price: row.minPrice,
    compareAtPrice: compareAt && row.minPrice && compareAt > row.minPrice ? compareAt : null,
    stockLevel: stockLevel(row.totalAvailable),
    stockLabel: stockLabel(row.totalAvailable),
  };
}

export const PRODUCT_DETAIL_SELECT = {
  id: true,
  slug: true,
  name: true,
  shortDesc: true,
  description: true,
  specs: true,
  seoTitle: true,
  seoDescription: true,
  brand: { select: { name: true, slug: true } },
  category: { select: { name: true, slug: true, parent: { select: { name: true, slug: true } } } },
  images: { select: { url: true, alt: true, variantId: true }, orderBy: { position: "asc" } },
  variants: {
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
    select: {
      id: true,
      sku: true,
      name: true,
      options: true,
      isDefault: true,
      price: { select: { amount: true, compareAtAmount: true } },
      inventory: { select: { availableQty: true } },
    },
  },
} satisfies Prisma.ProductSelect;

export type ProductDetailRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_DETAIL_SELECT }>;

export type PublicVariant = {
  id: string;
  sku: string;
  name: string;
  options: Record<string, string>;
  price: number | null;
  compareAtPrice: number | null;
  purchasable: boolean;
  stockLevel: StockLevel;
  stockLabel: string;
  /** Sepete eklenebilecek azami adet (tam stok sayısı gösterilmez). */
  maxQty: number;
};

export type PublicProductDetail = {
  id: string;
  slug: string;
  name: string;
  shortDesc: string | null;
  description: string | null;
  specs: { label: string; value: string }[];
  seoTitle: string | null;
  seoDescription: string | null;
  brand: { name: string; slug: string } | null;
  breadcrumbs: { name: string; href: string }[];
  images: { url: string; alt: string; variantId: string | null }[];
  variants: PublicVariant[];
};

function parseSpecs(value: Prisma.JsonValue): { label: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item && typeof item === "object" && !Array.isArray(item) && "label" in item && "value" in item) {
      return [{ label: String(item.label), value: String(item.value) }];
    }
    return [];
  });
}

function parseOptions(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
}

export function toProductDetail(row: ProductDetailRow): PublicProductDetail {
  const breadcrumbs: { name: string; href: string }[] = [];
  if (row.category?.parent) breadcrumbs.push({ name: row.category.parent.name, href: `/categories/${row.category.parent.slug}` });
  if (row.category) breadcrumbs.push({ name: row.category.name, href: `/categories/${row.category.slug}` });

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDesc: row.shortDesc,
    description: row.description,
    specs: parseSpecs(row.specs),
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    brand: row.brand,
    breadcrumbs,
    images: row.images.map((img) => ({ url: img.url, alt: img.alt ?? row.name, variantId: img.variantId })),
    variants: row.variants.map((v) => {
      const qty = v.inventory?.availableQty ?? 0;
      const price = v.price?.amount ?? null;
      return {
        id: v.id,
        sku: v.sku,
        name: v.name,
        options: parseOptions(v.options),
        price,
        compareAtPrice: v.price?.compareAtAmount && price && v.price.compareAtAmount > price ? v.price.compareAtAmount : null,
        purchasable: qty > 0 && price !== null,
        stockLevel: stockLevel(qty),
        stockLabel: stockLabel(qty),
        maxQty: Math.min(20, qty),
      };
    }),
  };
}
