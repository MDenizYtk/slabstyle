-- Arama altyapısı: trigram benzerliği ve aksan kaldırma.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() STABLE olduğu için indeks/generated kullanımına uygun değil; sabit sözlüklü IMMUTABLE sarmalayıcı.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "searchText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "searchVector" tsvector;

-- CreateIndex
CREATE INDEX "Product_searchVector_idx" ON "Product" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "Product_searchText_trgm_idx" ON "Product" USING GIN ("searchText" gin_trgm_ops);
