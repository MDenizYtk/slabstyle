import "server-only";
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import type { ListParams } from "@/domain/catalog/params";
import { db } from "../db";
import { PRODUCT_CARD_SELECT, PRODUCT_DETAIL_SELECT, toProductCard, toProductDetail, type PublicProductCard } from "./dto";
import { searchProductIds } from "./search";

const ACTIVE: Prisma.ProductWhereInput = { status: "ACTIVE" };

export const getNavCategories = cache(async () =>
  db.category.findMany({
    where: { parentId: null, isVisible: true },
    orderBy: { position: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      imageUrl: true,
      children: { where: { isVisible: true }, orderBy: { position: "asc" }, select: { slug: true, name: true } },
    },
  }),
);

async function cards(where: Prisma.ProductWhereInput, orderBy: Prisma.ProductOrderByWithRelationInput[], take: number) {
  const rows = await db.product.findMany({ where: { AND: [ACTIVE, where] }, orderBy, take, select: PRODUCT_CARD_SELECT });
  return rows.map(toProductCard);
}

export async function getHomeData() {
  const [featured, newest, deals, brands] = await Promise.all([
    cards({ isFeatured: true, totalAvailable: { gt: 0 } }, [{ totalAvailable: "desc" }], 8),
    cards({}, [{ publishedAt: "desc" }], 8),
    cards({ variants: { some: { price: { compareAtAmount: { not: null } } } } }, [{ minPrice: "asc" }], 4),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { slug: true, name: true }, take: 12 }),
  ]);
  return { featured, newest, deals, brands };
}

export type ProductListResult = {
  items: PublicProductCard[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  brandFacets: { slug: string; name: string; count: number }[];
};

function buildWhere(params: ListParams, scope: { categoryIds?: string[]; productIds?: string[] }, withBrand = true) {
  const and: Prisma.ProductWhereInput[] = [ACTIVE];
  if (scope.categoryIds) and.push({ categoryId: { in: scope.categoryIds } });
  if (scope.productIds) and.push({ id: { in: scope.productIds } });
  if (withBrand && params.brands.length) and.push({ brand: { slug: { in: params.brands } } });
  if (params.minPrice != null) and.push({ minPrice: { gte: params.minPrice } });
  if (params.maxPrice != null) and.push({ minPrice: { lte: params.maxPrice } });
  if (params.inStock) and.push({ totalAvailable: { gt: 0 } });
  return { AND: and } satisfies Prisma.ProductWhereInput;
}

function orderFor(sort: ListParams["sort"]): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "price_asc":
      return [{ minPrice: { sort: "asc", nulls: "last" } }, { id: "asc" }];
    case "price_desc":
      return [{ minPrice: { sort: "desc", nulls: "last" } }, { id: "asc" }];
    case "newest":
      return [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }];
    case "name":
      return [{ name: "asc" }];
    case "relevance":
      return [{ isFeatured: "desc" }, { totalAvailable: "desc" }, { publishedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }];
  }
}

/**
 * Listeleme, kategori ve arama sayfalarının ortak sorgusu. Arama terimi varsa
 * önce tam metin + trigram arama ile aday ürün id'leri sıralı olarak bulunur.
 */
export async function listProducts(params: ListParams, scope: { categoryIds?: string[] } = {}): Promise<ProductListResult> {
  let rankedIds: string[] | undefined;
  if (params.q) {
    rankedIds = await searchProductIds(params.q, 1000);
    if (rankedIds.length === 0) {
      return { items: [], total: 0, page: 1, pageSize: params.pageSize, pageCount: 0, brandFacets: [] };
    }
  }

  const where = buildWhere(params, { ...scope, productIds: rankedIds });
  const skip = (params.page - 1) * params.pageSize;
  const useRank = rankedIds && params.sort === "relevance";

  const [total, facetRows] = await Promise.all([
    db.product.count({ where }),
    db.product.groupBy({ by: ["brandId"], where: buildWhere(params, { ...scope, productIds: rankedIds }, false), _count: { _all: true } }),
  ]);

  let rows;
  if (useRank && rankedIds) {
    // Relevance sırası arama motorundan gelir: filtre sonrası kalan id'leri o sırayla sayfala.
    const matching = await db.product.findMany({ where, select: { id: true } });
    const allowed = new Set(matching.map((m) => m.id));
    const pageIds = rankedIds.filter((id) => allowed.has(id)).slice(skip, skip + params.pageSize);
    const found = await db.product.findMany({ where: { id: { in: pageIds } }, select: PRODUCT_CARD_SELECT });
    const byId = new Map(found.map((r) => [r.id, r]));
    rows = pageIds.map((id) => byId.get(id)).filter((r) => r !== undefined);
  } else {
    rows = await db.product.findMany({ where, orderBy: orderFor(params.sort), skip, take: params.pageSize, select: PRODUCT_CARD_SELECT });
  }

  const brandIds = facetRows.map((f) => f.brandId).filter((id): id is string => id !== null);
  const brands = brandIds.length
    ? await db.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, slug: true, name: true } })
    : [];
  const counts = new Map(facetRows.map((f) => [f.brandId, f._count._all]));
  const brandFacets = brands
    .map((b) => ({ slug: b.slug, name: b.name, count: counts.get(b.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));

  return {
    items: rows.map(toProductCard),
    total,
    page: params.page,
    pageSize: params.pageSize,
    pageCount: Math.ceil(total / params.pageSize),
    brandFacets,
  };
}

export const getCategoryBySlug = cache(async (slug: string) => {
  const category = await db.category.findFirst({
    where: { slug, isVisible: true },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      parent: { select: { slug: true, name: true } },
      children: { where: { isVisible: true }, orderBy: { position: "asc" }, select: { id: true, slug: true, name: true } },
    },
  });
  if (!category) return null;
  return { ...category, scopeIds: [category.id, ...category.children.map((c) => c.id)] };
});

export const getProductBySlug = cache(async (slug: string) => {
  const row = await db.product.findFirst({ where: { slug, ...ACTIVE }, select: PRODUCT_DETAIL_SELECT });
  return row ? toProductDetail(row) : null;
});

export async function getRelatedProducts(slug: string, take = 4): Promise<PublicProductCard[]> {
  const product = await db.product.findUnique({ where: { slug }, select: { id: true, categoryId: true } });
  if (!product?.categoryId) return [];
  return cards({ categoryId: product.categoryId, id: { not: product.id } }, [{ totalAvailable: "desc" }], take);
}
