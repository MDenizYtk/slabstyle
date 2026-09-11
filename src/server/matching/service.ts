import { decideMatch, normalizeBrand, type MatchDecision, type MatchSignals } from "@/domain/matching/decide";
import { normalizeGtin } from "@/domain/matching/gtin";
import type { DbClient } from "../db";

/** 14 haneli GTIN'in veritabanında saklanabilecek tüm biçimleri (8/12/13/14 hane). */
function gtinForms(raw: string | null): string[] {
  const n14 = normalizeGtin(raw);
  if (!n14) return [];
  const forms = new Set([n14]);
  for (const len of [13, 12, 8]) {
    const lead = n14.slice(0, 14 - len);
    if (/^0*$/.test(lead)) forms.add(n14.slice(14 - len));
  }
  return [...forms];
}

export async function collectSignals(
  db: DbClient,
  sp: { supplierSku: string; gtin: string | null; mpn: string | null; brandName: string | null; title: string },
): Promise<MatchSignals> {
  const forms = gtinForms(sp.gtin);
  const brand = normalizeBrand(sp.brandName);

  const [gtinRows, mpnRows, skuRows, fuzzyRows] = await Promise.all([
    forms.length ? db.productVariant.findMany({ where: { gtin: { in: forms } }, select: { id: true } }) : [],
    sp.mpn
      ? db.productVariant.findMany({
          where: { mpn: { equals: sp.mpn, mode: "insensitive" } },
          select: { id: true, gtin: true, product: { select: { brand: { select: { name: true } } } } },
          take: 10,
        })
      : [],
    db.productVariant.findMany({ where: { sku: { equals: sp.supplierSku, mode: "insensitive" } }, select: { id: true }, take: 5 }),
    db.$queryRaw<{ variantId: string; score: number }[]>`
      SELECT v.id AS "variantId", similarity(p."searchText", immutable_unaccent(lower(${sp.title})))::float AS score
      FROM "Product" p
      JOIN "ProductVariant" v ON v."productId" = p.id
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      WHERE p."searchText" % immutable_unaccent(lower(${sp.title}))
        AND (${brand} = '' OR regexp_replace(immutable_unaccent(lower(coalesce(b.name, ''))), '[^a-z0-9]', '', 'g') = ${brand})
      ORDER BY score DESC
      LIMIT 5`,
  ]);

  const spGtin = normalizeGtin(sp.gtin);
  return {
    gtinMatches: gtinRows.map((r) => r.id),
    mpnMatches: mpnRows.map((r) => ({
      variantId: r.id,
      brandMatches: brand !== "" && normalizeBrand(r.product.brand?.name) === brand,
      // Tedarikçi barkod verdi ve varyantın farklı barkodu var → aynı ürün değil olabilir.
      gtinConflict: Boolean(spGtin && r.gtin && normalizeGtin(r.gtin) !== spGtin),
    })),
    skuMatches: skuRows.map((r) => r.id),
    fuzzy: fuzzyRows,
  };
}

export type MatchOutcome = { decision: MatchDecision; variantId: string | null };

/**
 * Tek bir tedarikçi ürününü eşleştirir ve sonucu yazar. Admin tarafından elle
 * eşleştirilmiş (MANUAL_MATCHED) veya reddedilmiş (REJECTED) kayıtlara dokunulmaz.
 */
export async function matchSupplierProduct(db: DbClient, supplierProductId: string): Promise<MatchOutcome | null> {
  const sp = await db.supplierProduct.findUnique({
    where: { id: supplierProductId },
    select: { id: true, supplierSku: true, gtin: true, mpn: true, brandName: true, title: true, matchStatus: true, variantId: true },
  });
  if (!sp || sp.matchStatus === "MANUAL_MATCHED" || sp.matchStatus === "REJECTED") return null;

  const decision = decideMatch(await collectSignals(db, sp));

  if (decision.kind === "AUTO") {
    await db.supplierProduct.update({
      where: { id: sp.id },
      data: { variantId: decision.variantId, matchStatus: "AUTO_MATCHED", matchMethod: decision.method, matchConfidence: decision.confidence },
    });
    await db.productMatchCandidate.deleteMany({ where: { supplierProductId: sp.id, status: "PENDING" } });
    return { decision, variantId: decision.variantId };
  }

  if (decision.kind === "REVIEW") {
    await db.$transaction([
      db.supplierProduct.update({
        where: { id: sp.id },
        data: { variantId: null, matchStatus: "PENDING_REVIEW", matchMethod: null, matchConfidence: decision.candidates[0]?.score ?? null },
      }),
      ...decision.candidates.map((c) =>
        db.productMatchCandidate.upsert({
          where: { supplierProductId_variantId: { supplierProductId: sp.id, variantId: c.variantId } },
          create: { supplierProductId: sp.id, variantId: c.variantId, method: c.method, score: c.score },
          update: { method: c.method, score: c.score },
        }),
      ),
    ]);
    return { decision, variantId: null };
  }

  await db.supplierProduct.update({ where: { id: sp.id }, data: { variantId: null, matchStatus: "UNMATCHED", matchMethod: null, matchConfidence: null } });
  return { decision, variantId: null };
}
