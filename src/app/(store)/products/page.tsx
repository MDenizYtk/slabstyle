import type { Metadata } from "next";
import { ProductListing } from "@/components/store/ProductListing";
import { parseListParams } from "@/domain/catalog/params";
import { listProducts } from "@/server/catalog/queries";

export const metadata: Metadata = { title: "Tüm Ürünler" };

export default async function ProductsPage(props: PageProps<"/products">) {
  const params = parseListParams(await props.searchParams);
  const result = await listProducts(params);

  return (
    <div className="container-x py-10">
      <h1 className="slab mb-8 text-4xl">Tüm ürünler</h1>
      <ProductListing basePath="/products" params={params} result={result} />
    </div>
  );
}
