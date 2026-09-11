import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductListing } from "@/components/store/ProductListing";
import { parseListParams } from "@/domain/catalog/params";
import { getCategoryBySlug, listProducts } from "@/server/catalog/queries";

export async function generateMetadata(props: PageProps<"/categories/[slug]">): Promise<Metadata> {
  const category = await getCategoryBySlug((await props.params).slug);
  return category ? { title: category.name, description: category.description ?? undefined } : {};
}

export default async function CategoryPage(props: PageProps<"/categories/[slug]">) {
  const { slug } = await props.params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const params = parseListParams(await props.searchParams);
  const result = await listProducts(params, { categoryIds: category.scopeIds });

  return (
    <div className="container-x py-10">
      <nav className="mb-3 text-xs text-subtle" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-fg">Ana sayfa</Link>
        {category.parent && (
          <>
            {" / "}
            <Link href={`/categories/${category.parent.slug}`} className="hover:text-fg">{category.parent.name}</Link>
          </>
        )}
      </nav>
      <h1 className="slab text-4xl">{category.name}</h1>
      {category.description && <p className="mt-2 max-w-2xl text-muted">{category.description}</p>}

      {category.children.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {category.children.map((c) => (
            <Link key={c.id} href={`/categories/${c.slug}`} className="btn-secondary">{c.name}</Link>
          ))}
        </div>
      )}

      <div className="mt-8">
        <ProductListing basePath={`/categories/${category.slug}`} params={params} result={result} />
      </div>
    </div>
  );
}
