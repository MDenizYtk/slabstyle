import "server-only";
import { db } from "../db";

/**
 * Ürün arama. PostgreSQL tam metin araması (Türkçe olmayan "simple" sözlük +
 * unaccent) ile pg_trgm benzerliğini birleştirir; barkod ve SKU için tam eşleşme
 * en üste alınır. Yüz binlerce ürün için GIN indeksleri migration'da tanımlıdır.
 *
 * Arama altyapısı ileride Meilisearch/OpenSearch'e taşınırsa yalnızca bu dosya değişir.
 */
export async function searchProductIds(rawQuery: string, limit = 500): Promise<string[]> {
  const q = rawQuery.trim().slice(0, 100);
  if (!q) return [];

  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH input AS (
      SELECT immutable_unaccent(lower(${q})) AS term,
             websearch_to_tsquery('simple', immutable_unaccent(lower(${q}))) AS tsq
    ),
    exact AS (
      SELECT DISTINCT v."productId" AS id, 3.0::float AS score
      FROM "ProductVariant" v, input
      WHERE lower(v.sku) = lower(${q}) OR v.gtin = ${q} OR lower(v.mpn) = lower(${q})
    ),
    ranked AS (
      SELECT p.id,
             ts_rank(p."searchVector", input.tsq) * 2
               + similarity(p."searchText", input.term) AS score
      FROM "Product" p, input
      WHERE p.status = 'ACTIVE'
        AND (p."searchVector" @@ input.tsq OR p."searchText" % input.term OR p."searchText" LIKE '%' || input.term || '%')
    )
    SELECT id FROM (
      SELECT id, MAX(score) AS score FROM (SELECT * FROM exact UNION ALL SELECT * FROM ranked) u GROUP BY id
    ) s
    ORDER BY score DESC, id
    LIMIT ${limit}`;

  return rows.map((r) => r.id);
}
