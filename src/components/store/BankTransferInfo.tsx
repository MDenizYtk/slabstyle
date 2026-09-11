import { formatIban, normalizeIban } from "@/domain/payments/iban";
import { formatMoney } from "@/lib/money";
import type { BankTransferSettings } from "@/server/settings";
import { CopyButton } from "./CopyButton";

/** Havale/EFT talimatı: IBAN, alıcı, tutar ve açıklamaya yazılacak sipariş numarası. */
export function BankTransferInfo({
  settings,
  amount,
  orderNumber,
  createdAt,
}: {
  settings: BankTransferSettings;
  amount: number;
  orderNumber: number;
  createdAt: Date;
}) {
  const reference = `SS-${orderNumber}`;
  const deadline = new Date(createdAt.getTime() + settings.expireHours * 3_600_000);
  const rows: { label: string; value: string; copy?: string }[] = [
    { label: "Alıcı", value: settings.accountHolder, copy: settings.accountHolder },
    { label: "Banka", value: settings.bankName },
    { label: "IBAN", value: formatIban(settings.iban), copy: normalizeIban(settings.iban) },
    { label: "Tutar", value: formatMoney(amount), copy: (amount / 100).toFixed(2).replace(".", ",") },
    { label: "Açıklama", value: reference, copy: reference },
  ];

  return (
    <section className="card space-y-4 border-accent/40 p-6 text-left" aria-labelledby="bank-title">
      <h2 id="bank-title" className="slab text-xl">Havale / EFT bilgileri</h2>
      <dl className="divide-y divide-line rounded-lg border border-line">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <dt className="text-muted">{r.label}</dt>
            <dd className="flex items-center gap-2 text-right font-semibold">
              <span className={r.label === "IBAN" ? "font-mono" : ""}>{r.value}</span>
              {r.copy && <CopyButton value={r.copy} />}
            </dd>
          </div>
        ))}
      </dl>
      <ul className="space-y-1 text-sm text-muted">
        <li>Açıklama kısmına mutlaka <strong className="text-fg">{reference}</strong> yazın; ödemeniz bu numarayla eşleştirilir.</li>
        <li>Ödemenizi <strong className="text-fg">{deadline.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}</strong> tarihine kadar yapın; aksi halde sipariş iptal edilir.</li>
        <li>Ödemeniz hesabımıza ulaştığında siparişiniz onaylanır ve hazırlanmaya başlar.</li>
        {settings.note && <li>{settings.note}</li>}
      </ul>
    </section>
  );
}
