import { EmptyRow, PageHeader } from "@/components/admin/ui";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireStaff } from "@/server/auth/dal";
import { db } from "@/server/db";

export const metadata = { title: "Webhooklar" };

export default async function WebhooksPage() {
  await requireStaff();
  const events = await db.webhookEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: { id: true, provider: true, externalEventId: true, eventType: true, status: true, attempts: true, error: true, receivedAt: true, processedAt: true },
  });
  return (
    <>
      <PageHeader title="Webhooklar" description="Ödeme ve tedarikçi bildirimleri. Aynı olay tekrar gelirse yeniden işlenmez." />
      <div className="card overflow-x-auto">
        <table className="table-x">
          <thead><tr><th>Kaynak</th><th>Olay</th><th>Olay no</th><th>Durum</th><th>Deneme</th><th>Alındı</th><th>Hata</th></tr></thead>
          <tbody>
            {events.length === 0 && <EmptyRow colSpan={7} />}
            {events.map((e) => (
              <tr key={e.id}>
                <td>{e.provider}</td>
                <td className="text-xs">{e.eventType}</td>
                <td className="font-mono text-xs text-muted">{e.externalEventId}</td>
                <td><StatusBadge status={e.status === "PROCESSED" ? "SUCCEEDED" : e.status} label={e.status} /></td>
                <td>{e.attempts}</td>
                <td className="text-xs text-subtle">{e.receivedAt.toLocaleString("tr-TR")}</td>
                <td className="max-w-xs truncate text-xs text-bad">{e.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
