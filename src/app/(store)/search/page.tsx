import type { Metadata } from "next";
import { ProductListing } from "@/components/store/ProductListing";
import { parseListParams } from "@/domain/catalog/params";
import { listProducts } from "@/server/catalog/queries";

export const metadata: Metadata = { title: "Arama", robots: { index: false } };

export default async function SearchPage(props: PageProps<"/search">) {
  const params = parseListParams(await props.searchParams);
  const result = params.q ? await listProducts(params) : null;

  return (
    <div className="container-x py-10">
      <h1 className="slab mb-2 text-4xl">Arama</h1>
      <form action="/search" className="mb-8 flex max-w-xl gap-2">
        <label htmlFor="q" className="sr-only">Arama terimi</label>
        <input id="q" name="q" type="search" defaultValue={params.q} placeholder="Ürün adı, marka, SKU veya barkod" className="input" autoFocus />
        <button className="btn-primary">Ara</button>
      </form>
      {result ? (
        <>
          <p className="mb-6 text-muted">
            “{params.q}” için {result.total} sonuç
          </p>
          <ProductListing basePath="/search" params={params} result={result} />
        </>
      ) : (
        <p className="text-muted">Aramak istediğiniz ürünü yazın.</p>
      )}
    </div>
  );
}
