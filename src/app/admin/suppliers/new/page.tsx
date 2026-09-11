import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { SupplierForm } from "@/components/admin/SupplierForms";
import { requireAdmin } from "@/server/auth/dal";
import { listAdapters } from "@/server/suppliers/registry";

export const metadata = { title: "Tedarikçi ekle" };

export default async function NewSupplierPage() {
  await requireAdmin();
  return (
    <>
      <Link href="/admin/suppliers" className="text-sm text-muted hover:text-fg">← Tedarikçiler</Link>
      <PageHeader title="Tedarikçi ekle" description="Önce PAUSED olarak kaydedin, bağlantı testinden sonra aktifleştirin." />
      <SupplierForm
        adapters={listAdapters()}
        initial={{
          code: "", name: "", status: "PAUSED", integrationType: "XML_FEED", adapterKey: "generic-feed",
          priority: 0, defaultLeadTimeDays: 2, safetyStock: 0, stockSyncIntervalMin: 15, catalogSyncIntervalMin: 240,
          autoSubmitOrders: false, notes: "", config: "{}",
        }}
      />
    </>
  );
}
