import Link from "next/link";
import { EmptyRow, PageHeader, StatCard } from "@/components/admin/ui";
import { ProductImage } from "@/components/store/ProductImage";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { isShop } from "@/config/mode";
import { ORDER_STATUS_LABEL, SYNC_STATUS_LABEL } from "@/domain/orders/status";
import { formatMoney } from "@/lib/money";
import { getDashboardStats, getShowcaseStats } from "@/server/admin/dashboard";
import { requireStaff } from "@/server/auth/dal";

export default async function AdminDashboard() {
  // Layout da kontrol eder ama sayfa layout ile paralel çalışır; yetki her sayfada ayrıca doğrulanır.
  await requireStaff();
  return isShop ? <ShopDashboard /> : <ShowcaseDashboard />;
}

/** Vitrin modu: ürün ve fotoğraf odaklı sade özet. */
async function ShowcaseDashboard() {
  const s = await getShowcaseStats();
  return (
    <>
      <PageHeader
        title="Özet"
        description="Vitrin modu: ziyaretçiler ürünleri ve fotoğrafları görür, WhatsApp ile iletişime geçer."
        actions={<Link href="/admin/products/new" className="btn-primary">Yeni ürün</Link>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Yayındaki ürün" value={s.activeProducts} href="/admin/products?status=ACTIVE" />
        <StatCard label="Taslak ürün" value={s.draftProducts} hint="Yayına almayı unutma" tone={s.draftProducts ? "warn" : undefined} href="/admin/products?status=DRAFT" />
        <StatCard label="Fotoğrafsız ürün" value={s.withoutImage} tone={s.withoutImage ? "warn" : "ok"} href="/admin/products" />
        <StatCard label="Kategori" value={s.categories} href="/admin/categories" />
      </div>

      {!s.hasContact && (
        <p className="card mt-6 border-warn/40 p-4 text-sm text-warn">
          İletişim bilgisi girilmemiş: ziyaretçiler sipariş için sana ulaşamaz. <Link href="/admin/settings" className="underline">Ayarlar</Link> sayfasından WhatsApp numaranı ekle.
        </p>
      )}

      <section className="card mt-8 overflow-hidden">
        <h2 className="border-b border-line px-4 py-3 font-semibold">Son eklenen ürünler</h2>
        <table className="table-x">
          <tbody>
            {s.recentProducts.length === 0 && <EmptyRow colSpan={4} text="Henüz ürün yok. 'Yeni ürün' ile başla." />}
            {s.recentProducts.map((p) => (
              <tr key={p.id}>
                <td className="w-16">
                  <Link href={`/admin/products/${p.id}`} className="relative block h-12 w-12 overflow-hidden rounded-md bg-panel-2">
                    <ProductImage src={p.images[0]?.url ?? null} alt={p.name} sizes="48px" />
                  </Link>
                </td>
                <td><Link href={`/admin/products/${p.id}`} className="font-semibold hover:text-accent">{p.name}</Link></td>
                <td className="text-muted">{p.category?.name ?? "—"}</td>
                <td className="text-right">{p.minPrice != null ? formatMoney(p.minPrice) : "Fiyat yok"}</td>
                <td><StatusBadge status={p.status} label={p.status === "ACTIVE" ? "Yayında" : p.status === "DRAFT" ? "Taslak" : "Arşiv"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** Tam mağaza modu: satış, sipariş ve tedarikçi özeti. */
async function ShopDashboard() {
  const s = await getDashboardStats();

  return (
    <>
      <PageHeader title="Dashboard" description="Satış, stok ve entegrasyon durumunun özeti" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Toplam satış" value={formatMoney(s.revenue)} hint="Ödenmiş siparişler" />
        <StatCard label="Tahmini kâr" value={formatMoney(s.estimatedProfit)} hint="Ürün satışı − tedarikçi maliyeti" tone="ok" />
        <StatCard label="Siparişler" value={s.orderCount} href="/admin/orders" />
        <StatCard label="Bekleyen siparişler" value={s.pendingOrders} tone={s.pendingOrders ? "warn" : undefined} href="/admin/orders?status=PAID" />
        <StatCard label="Havale bekleyen" value={s.awaitingTransfer} hint="Para gelince siparişten onayla" tone={s.awaitingTransfer ? "warn" : undefined} href="/admin/orders?status=PENDING_PAYMENT" />
        <StatCard label="Aktif ürün" value={s.productCount} href="/admin/products" />
        <StatCard label="Tedarikçi" value={s.supplierCount} href="/admin/suppliers" />
        <StatCard label="Stok sorunu" value={s.outOfStock} hint="Stokta olmayan aktif ürün" tone={s.outOfStock ? "warn" : undefined} href="/admin/products?stock=out" />
        <StatCard label="Başarısız sync (24s)" value={s.failedSyncs} tone={s.failedSyncs ? "bad" : "ok"} href="/admin/sync?status=FAILED" />
        <StatCard label="Eşleşmemiş ürün" value={s.unmatched} tone={s.unmatched ? "warn" : undefined} href="/admin/matching" />
        <StatCard label="Onay bekleyen eşleşme" value={s.pendingReview} tone={s.pendingReview ? "warn" : undefined} href="/admin/matching?tab=review" />
        <StatCard label="Müdahale gereken tedarikçi siparişi" value={s.supplierOrdersAttention} tone={s.supplierOrdersAttention ? "bad" : undefined} href="/admin/orders?attention=1" />
        <StatCard label="Açık iade" value={s.openReturns} tone={s.openReturns ? "warn" : undefined} href="/admin/returns" />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <section className="card overflow-x-auto">
          <h2 className="border-b border-line px-4 py-3 font-semibold">Son siparişler</h2>
          <table className="table-x">
            <tbody>
              {s.recentOrders.length === 0 && <EmptyRow colSpan={4} />}
              {s.recentOrders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/admin/orders/${o.id}`} className="font-semibold text-accent">#{o.number}</Link></td>
                  <td className="text-muted">{o.user.name}</td>
                  <td><StatusBadge status={o.status} label={ORDER_STATUS_LABEL[o.status]} /></td>
                  <td className="text-right">{formatMoney(o.grandTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card overflow-x-auto">
          <h2 className="border-b border-line px-4 py-3 font-semibold">Son senkronizasyonlar</h2>
          <table className="table-x">
            <tbody>
              {s.recentSyncs.length === 0 && <EmptyRow colSpan={4} text="Henüz senkronizasyon çalışmadı" />}
              {s.recentSyncs.map((j) => (
                <tr key={j.id}>
                  <td>{j.supplier.name}</td>
                  <td className="text-muted">{j.type}</td>
                  <td><StatusBadge status={j.status} label={SYNC_STATUS_LABEL[j.status]} /></td>
                  <td className="text-right text-xs text-subtle">{j.queuedAt.toLocaleString("tr-TR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
