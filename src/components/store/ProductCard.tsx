import Link from "next/link";
import { isShop } from "@/config/mode";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PublicProductCard } from "@/server/catalog/dto";
import { ProductImage } from "./ProductImage";

export function StockBadge({ level, label }: { level: PublicProductCard["stockLevel"]; label: string }) {
  return (
    <span
      className={cn(
        "badge",
        level === "IN_STOCK" && "bg-ok/15 text-ok",
        level === "LOW" && "bg-warn/15 text-warn",
        level === "OUT_OF_STOCK" && "bg-bad/15 text-bad",
      )}
    >
      {label}
    </span>
  );
}

export function ProductCard({ product }: { product: PublicProductCard }) {
  const discount =
    product.compareAtPrice && product.price
      ? Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)
      : 0;

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group card flex flex-col overflow-hidden transition-colors hover:border-accent/60"
    >
      <div className="relative aspect-square overflow-hidden bg-panel-2">
        <ProductImage src={product.imageUrl} alt={product.imageAlt} />
        {discount > 0 && (
          <span className="badge absolute left-2 top-2 bg-accent text-black">-%{discount}</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        {product.brand && (
          <span className="text-[11px] font-semibold uppercase tracking-widest text-subtle">{product.brand.name}</span>
        )}
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-fg group-hover:text-accent">{product.name}</h3>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="flex flex-col">
            {product.compareAtPrice && (
              <span className="text-xs text-subtle line-through">{formatMoney(product.compareAtPrice)}</span>
            )}
            <span className="text-lg font-bold text-fg">
              {product.price != null ? formatMoney(product.price) : "—"}
            </span>
          </div>
          {isShop && <StockBadge level={product.stockLevel} label={product.stockLabel} />}
        </div>
      </div>
    </Link>
  );
}

export function ProductGrid({ products }: { products: PublicProductCard[] }) {
  if (products.length === 0) {
    return <p className="card p-8 text-center text-muted">Bu kriterlere uygun ürün bulunamadı.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
