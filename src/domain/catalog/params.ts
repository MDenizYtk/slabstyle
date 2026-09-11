import { z } from "zod";

/**
 * Ürün listeleme / arama URL parametreleri. Tüm girdiler burada doğrulanır ve
 * normalize edilir; geçersiz değerler sessizce varsayılana döner.
 */

export const SORT_OPTIONS = {
  relevance: "Önerilen",
  newest: "En yeni",
  price_asc: "Fiyat: artan",
  price_desc: "Fiyat: azalan",
  name: "İsim (A-Z)",
} as const;

export type SortOption = keyof typeof SORT_OPTIONS;

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 20);

const optionalTl = z.preprocess((v) => {
  const raw = first(v);
  if (raw === undefined || raw === "") return undefined;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
}, z.number().int().min(0).optional());

export const listParamsSchema = z.object({
  q: z.preprocess((v) => (typeof first(v) === "string" ? String(first(v)).trim().slice(0, 100) : undefined), z.string().optional()),
  category: z.preprocess(first, z.string().regex(/^[a-z0-9-]+$/).max(100).optional().catch(undefined)),
  brands: z.preprocess(list, z.array(z.string().regex(/^[a-z0-9-]+$/).max(100)).catch([])),
  minPrice: optionalTl.catch(undefined),
  maxPrice: optionalTl.catch(undefined),
  inStock: z.preprocess((v) => first(v) === "1" || first(v) === "true", z.boolean()),
  sort: z.preprocess(first, z.enum(Object.keys(SORT_OPTIONS) as [SortOption, ...SortOption[]]).catch("relevance")),
  page: z.preprocess((v) => Number(first(v) ?? 1), z.number().int().min(1).max(500).catch(1)),
  pageSize: z.preprocess((v) => Number(first(v) ?? 24), z.number().int().min(12).max(60).catch(24)),
});

export type ListParams = z.infer<typeof listParamsSchema>;

export function parseListParams(searchParams: Record<string, string | string[] | undefined>): ListParams {
  return listParamsSchema.parse(searchParams);
}

/** Mevcut parametrelerden yeni bir query string üretir (filtre linkleri için). */
export function buildQuery(params: Partial<ListParams>, overrides: Partial<ListParams> = {}): string {
  const merged = { ...params, ...overrides };
  const sp = new URLSearchParams();
  if (merged.q) sp.set("q", merged.q);
  if (merged.brands?.length) sp.set("brands", merged.brands.join(","));
  if (merged.minPrice != null) sp.set("minPrice", String(merged.minPrice / 100));
  if (merged.maxPrice != null) sp.set("maxPrice", String(merged.maxPrice / 100));
  if (merged.inStock) sp.set("inStock", "1");
  if (merged.sort && merged.sort !== "relevance") sp.set("sort", merged.sort);
  if (merged.page && merged.page > 1) sp.set("page", String(merged.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
